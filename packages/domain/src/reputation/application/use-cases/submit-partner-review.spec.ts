import { beforeEach, describe, expect, it } from "vitest";
import { toExchangeId, toMemberId } from "../../../shared-kernel";
import { PartnerReviewScoresInput } from "../../domain";
import {
  FakeExchangeCompletionPort,
  FixedClock,
  InMemoryPartnerReviewRepository,
  InMemoryReputationProfileRepository,
  RecordingEventPublisher,
  SequentialPartnerReviewIdGenerator,
  SequentialReputationProfileIdGenerator,
} from "../testing";
import { makeSubmitPartnerReview } from "./submit-partner-review";

const alice = toMemberId("alice"); // reviewer
const bob = toMemberId("bob"); // reviewee
const carol = toMemberId("carol"); // outsider
const exchangeId = toExchangeId("ex-1");
const otherExchange = toExchangeId("ex-2");
const NOW = new Date("2026-06-08T10:00:00Z");

const goodScores: PartnerReviewScoresInput = {
  communication: 5,
  packaging: 4,
  condition: 4,
  timeliness: 3,
};

describe("makeSubmitPartnerReview", () => {
  let reviews: InMemoryPartnerReviewRepository;
  let profiles: InMemoryReputationProfileRepository;
  let exchanges: FakeExchangeCompletionPort;
  let events: RecordingEventPublisher;
  let submit: ReturnType<typeof makeSubmitPartnerReview>;

  beforeEach(() => {
    reviews = new InMemoryPartnerReviewRepository();
    profiles = new InMemoryReputationProfileRepository();
    exchanges = new FakeExchangeCompletionPort();
    events = new RecordingEventPublisher();
    submit = makeSubmitPartnerReview({
      reviews,
      profiles,
      exchanges,
      reviewIds: new SequentialPartnerReviewIdGenerator(),
      profileIds: new SequentialReputationProfileIdGenerator(),
      events,
      clock: new FixedClock(NOW),
    });
  });

  const cmd = (over: Partial<Parameters<typeof submit>[0]> = {}) => ({
    exchangeId,
    reviewerId: alice,
    revieweeId: bob,
    rating: 4,
    comment: "Great partner",
    scores: goodScores,
    ...over,
  });

  it("submits a review: saves it, recomputes the reviewee profile, and publishes both events", async () => {
    exchanges.seedCompleted(exchangeId, alice, bob);

    const result = await submit(cmd());

    expect(result.isOk).toBe(true);
    expect(reviews.size()).toBe(1);
    expect(profiles.size()).toBe(1);

    const profile = await profiles.findByMember(bob);
    expect(profile?.reviewCount).toBe(1);
    expect(profile?.averageRating).toBe(4);

    expect(events.names()).toEqual([
      "PartnerReviewSubmitted",
      "ReputationChanged",
    ]);
    const changed = events.published.find(
      (e) => e.name === "ReputationChanged",
    ) as unknown as {
      averageRating: number;
      reviewCount: number;
    };
    expect(changed.averageRating).toBe(4);
    expect(changed.reviewCount).toBe(1);
  });

  it("rejects a self-review and writes nothing", async () => {
    exchanges.seedCompleted(exchangeId, alice, alice);

    const result = await submit(cmd({ revieweeId: alice }));

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("SelfReview");
    expect(reviews.size()).toBe(0);
    expect(profiles.size()).toBe(0);
    expect(events.published).toHaveLength(0);
  });

  it("rejects when the exchange is not completed (no window)", async () => {
    // exchange not seeded ⇒ not completed
    const result = await submit(cmd());

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ExchangeNotCompleted");
    expect(reviews.size()).toBe(0);
    expect(events.published).toHaveLength(0);
  });

  it("rejects a non-participant of the completed exchange", async () => {
    exchanges.seedCompleted(exchangeId, alice, bob);

    // carol was not a party to ex-1
    const result = await submit(cmd({ revieweeId: carol }));

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ExchangeNotCompleted");
    expect(reviews.size()).toBe(0);
  });

  it("rejects a duplicate review by the same reviewer for the same exchange", async () => {
    exchanges.seedCompleted(exchangeId, alice, bob);
    expect((await submit(cmd())).isOk).toBe(true);

    const second = await submit(cmd());
    expect(second.isErr).toBe(true);
    if (second.isErr) expect(second.error.code).toBe("DuplicatePartnerReview");
    expect(reviews.size()).toBe(1); // no second review written
  });

  it.each([0, 6])(
    "rejects an out-of-bounds rating %s without writing",
    async (rating) => {
      exchanges.seedCompleted(exchangeId, alice, bob);

      const result = await submit(cmd({ rating }));
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidRating");
      expect(reviews.size()).toBe(0);
      expect(events.published).toHaveLength(0);
    },
  );

  it("accumulates multiple reviews into one reviewee profile and recomputes the average", async () => {
    exchanges
      .seedCompleted(exchangeId, alice, bob)
      .seedCompleted(otherExchange, carol, bob);

    const first = await submit(cmd({ rating: 5 }));
    expect(first.isOk).toBe(true);

    // A different reviewer on a different completed exchange, same reviewee.
    const second = await submit(
      cmd({ exchangeId: otherExchange, reviewerId: carol, rating: 1 }),
    );
    expect(second.isOk).toBe(true);

    expect(reviews.size()).toBe(2);
    expect(profiles.size()).toBe(1); // single profile keyed by reviewee
    const profile = await profiles.findByMember(bob);
    expect(profile?.reviewCount).toBe(2);
    expect(profile?.averageRating).toBe(3); // (5 + 1) / 2
  });

  it("allows the counterparty to review back (distinct reviewer, same exchange)", async () => {
    exchanges.seedCompleted(exchangeId, alice, bob);
    expect((await submit(cmd())).isOk).toBe(true);

    // bob reviews alice for the same exchange: different reviewer ⇒ not a duplicate.
    const back = await submit(cmd({ reviewerId: bob, revieweeId: alice }));
    expect(back.isOk).toBe(true);
    expect(reviews.size()).toBe(2);
    expect((await profiles.findByMember(alice))?.reviewCount).toBe(1);
  });
});

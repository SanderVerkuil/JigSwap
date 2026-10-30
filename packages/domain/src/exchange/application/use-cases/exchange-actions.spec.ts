import { beforeEach, describe, expect, it } from "vitest";
import { toCopyId, toExchangeId, toMemberId } from "../../../shared-kernel";
import { EligibleVia, Exchange, MemberId } from "../../domain";
import { CopyView } from "../ports/out/copy.port";
import {
  FakeCopyPort,
  FakeExchangeEligibilityPort,
  FixedClock,
  InMemoryExchangeRepository,
  RecordingEventPublisher,
} from "../testing";
import { makeAcceptExchange } from "./accept-exchange";
import { makeCancelExchange } from "./cancel-exchange";
import { makeConfirmCompletion } from "./confirm-completion";
import { makeDeclineExchange } from "./decline-exchange";
import { makeRaiseDispute } from "./raise-dispute";

const alice = toMemberId("alice"); // initiator
const bob = toMemberId("bob"); // recipient
const eve = toMemberId("eve"); // outsider
const carol = toMemberId("carol"); // alice's housemate
const requestedId = toCopyId("requested");
const offeredId = toCopyId("offered");
const exId = toExchangeId("ex-1");
const NOW = new Date("2026-06-08T10:00:00Z");
const LATER = new Date("2026-06-09T10:00:00Z");

// A proposed swap exchange, persisted, ready for a lifecycle action.
// `eligibleVia` left out: a row proposed before the route kind was recorded.
const seedProposed = async (
  repo: InMemoryExchangeRepository,
  eligibleVia?: EligibleVia,
): Promise<void> => {
  const result = Exchange.propose({
    id: exId,
    initiator: alice,
    recipient: bob,
    requestedCopyId: requestedId,
    terms: { kind: "lend", returnDate: LATER },
    eligibleVia,
    now: NOW,
  });
  if (!result.isOk) throw new Error("setup");
  result.value.pullEvents();
  await repo.save(result.value);
};

// A proposed swap of Bob's requested copy for the offered copy, recorded as owned by
// `offeredCopyOwnerId` when proposed (left out: a row proposed before the owner was recorded).
const seedProposedSwap = async (
  repo: InMemoryExchangeRepository,
  offeredCopyOwnerId?: MemberId,
): Promise<void> => {
  const result = Exchange.propose({
    id: exId,
    initiator: alice,
    recipient: bob,
    requestedCopyId: requestedId,
    terms: { kind: "swap", offeredCopyId: offeredId },
    offeredCopyOwnerId,
    now: NOW,
  });
  if (!result.isOk) throw new Error("setup");
  result.value.pullEvents();
  await repo.save(result.value);
};

const acceptStored = async (repo: InMemoryExchangeRepository) => {
  const ex = await repo.findById(exId);
  if (!ex) throw new Error("setup");
  ex.accept(bob, NOW);
  ex.pullEvents();
  await repo.save(ex);
};

const seedAccepted = async (
  repo: InMemoryExchangeRepository,
): Promise<void> => {
  await seedProposed(repo);
  await acceptStored(repo);
};

const copyView = (
  id: CopyView["id"],
  ownerId: MemberId,
  coManagerIds: readonly MemberId[] = [],
): CopyView => ({
  id,
  ownerId,
  coManagerIds,
  availability: { forTrade: true, forSale: true, forLend: true },
});

// The requested copy starts with its recipient, as when the exchange was proposed.
const harness = () => {
  const repo = new InMemoryExchangeRepository();
  const events = new RecordingEventPublisher();
  const clock = new FixedClock(NOW);
  const eligibility = new FakeExchangeEligibilityPort();
  const copies = new FakeCopyPort().seed(copyView(requestedId, bob));
  return { repo, events, clock, eligibility, copies, exchanges: repo };
};

describe("makeAcceptExchange", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => (h = harness()));

  it("accepts a proposed exchange, persisting and publishing ExchangeAccepted", async () => {
    await seedProposed(h.repo);
    const result = await makeAcceptExchange(h)({
      exchangeId: exId,
      actingMemberId: bob,
    });
    expect(result.isOk).toBe(true);
    expect(h.events.names()).toEqual(["ExchangeAccepted"]);
    expect((await h.repo.findById(exId))?.status).toBe("accepted");
  });

  it("returns ExchangeNotFound when no exchange exists", async () => {
    const result = await makeAcceptExchange(h)({
      exchangeId: exId,
      actingMemberId: bob,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ExchangeNotFound");
  });

  it("delegates wrong-party rejection to the aggregate", async () => {
    await seedProposed(h.repo);
    const result = await makeAcceptExchange(h)({
      exchangeId: exId,
      actingMemberId: alice,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("WrongParty");
    expect(h.events.published).toHaveLength(0);
  });

  it("refuses with NotPermittedInCircle when the initiator is no longer eligible, saving nothing", async () => {
    await seedProposed(h.repo);
    h.eligibility.deny();
    const result = await makeAcceptExchange(h)({
      exchangeId: exId,
      actingMemberId: bob,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotPermittedInCircle");
    expect(h.events.published).toHaveLength(0);
    expect((await h.repo.findById(exId))?.status).toBe("proposed");
  });

  describe("re-checks only what the request rested on", () => {
    const accept = () =>
      makeAcceptExchange(h)({ exchangeId: exId, actingMemberId: bob });
    const codeOf = async () => {
      const result = await accept();
      return result.isErr ? result.error.code : "ok";
    };

    it("direct: accepts even when no route is left at all", async () => {
      await seedProposed(h.repo, "direct");
      h.eligibility.deny();
      expect(await codeOf()).toBe("ok");
    });

    it("circle: refuses once the circle seat is gone, whatever the direct routes", async () => {
      await seedProposed(h.repo, "circle");
      h.eligibility.allowVia("direct").withCircleSeat(false);
      expect(await codeOf()).toBe("NotPermittedInCircle");
    });

    it("circle: accepts while a circle seat remains", async () => {
      await seedProposed(h.repo, "circle");
      h.eligibility.allowVia(null).withCircleSeat(true);
      expect(await codeOf()).toBe("ok");
    });

    it("legacy: accepts on a direct route now, without a circle seat", async () => {
      await seedProposed(h.repo);
      h.eligibility.allowVia("direct").withCircleSeat(false);
      expect(await codeOf()).toBe("ok");
    });

    it("legacy: otherwise falls back to the circle check", async () => {
      await seedProposed(h.repo);
      h.eligibility.allowVia("circle").withCircleSeat(true);
      expect(await codeOf()).toBe("ok");
    });
  });

  it("answers a wrong party with WrongParty before asking about eligibility", async () => {
    await seedProposed(h.repo);
    h.eligibility.deny();
    const result = await makeAcceptExchange(h)({
      exchangeId: exId,
      actingMemberId: eve,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("WrongParty");
  });

  it("delegates illegal-transition rejection to the aggregate", async () => {
    await seedAccepted(h.repo);
    const result = await makeAcceptExchange(h)({
      exchangeId: exId,
      actingMemberId: bob,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("IllegalTransition");
  });

  // The settlement guard: an exchange is accepted only while it could still settle.
  describe("refuses once a copy is no longer where the deal was made", () => {
    const accept = () =>
      makeAcceptExchange(h)({ exchangeId: exId, actingMemberId: bob });

    it("RecipientNotOwner once the requested copy changed hands, saving nothing", async () => {
      await seedProposed(h.repo);
      h.copies.seed(copyView(requestedId, eve));
      const result = await accept();
      expect(result.isErr && result.error.code).toBe("RecipientNotOwner");
      expect(h.events.published).toHaveLength(0);
      expect((await h.repo.findById(exId))?.status).toBe("proposed");
    });

    it("OfferedCopyNotOwned once the initiator no longer co-manages the offered copy", async () => {
      await seedProposedSwap(h.repo, carol);
      h.copies.seed(copyView(offeredId, carol, [])); // alice left carol's household
      const result = await accept();
      expect(result.isErr && result.error.code).toBe("OfferedCopyNotOwned");
      expect((await h.repo.findById(exId))?.status).toBe("proposed");
    });

    it("accepts a swap while both copies are still in place", async () => {
      await seedProposedSwap(h.repo, carol);
      h.copies.seed(copyView(offeredId, carol, [alice]));
      expect((await accept()).isOk).toBe(true);
      expect((await h.repo.findById(exId))?.status).toBe("accepted");
    });

    it("answers a lost circle seat before a moved copy", async () => {
      await seedProposed(h.repo, "circle");
      h.eligibility.withCircleSeat(false);
      h.copies.seed(copyView(requestedId, eve));
      const result = await accept();
      expect(result.isErr && result.error.code).toBe("NotPermittedInCircle");
    });
  });
});

describe("makeDeclineExchange", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => (h = harness()));

  it("declines a proposed exchange, publishing ExchangeRejected", async () => {
    await seedProposed(h.repo);
    const result = await makeDeclineExchange(h)({
      exchangeId: exId,
      actingMemberId: bob,
    });
    expect(result.isOk).toBe(true);
    expect(h.events.names()).toEqual(["ExchangeRejected"]);
    expect((await h.repo.findById(exId))?.status).toBe("rejected");
  });

  it("returns ExchangeNotFound when no exchange exists", async () => {
    const result = await makeDeclineExchange(h)({
      exchangeId: exId,
      actingMemberId: bob,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ExchangeNotFound");
  });
});

describe("makeCancelExchange", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => (h = harness()));

  it("lets the initiator cancel, publishing ExchangeCancelled", async () => {
    await seedProposed(h.repo);
    const result = await makeCancelExchange(h)({
      exchangeId: exId,
      actingMemberId: alice,
    });
    expect(result.isOk).toBe(true);
    expect(h.events.names()).toEqual(["ExchangeCancelled"]);
    expect((await h.repo.findById(exId))?.status).toBe("cancelled");
  });

  it("delegates wrong-party rejection to the aggregate", async () => {
    await seedProposed(h.repo);
    const result = await makeCancelExchange(h)({
      exchangeId: exId,
      actingMemberId: bob,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("WrongParty");
  });
});

describe("makeRaiseDispute", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => (h = harness()));

  it("lets a party dispute an accepted exchange, publishing DisputeRaised", async () => {
    await seedAccepted(h.repo);
    const result = await makeRaiseDispute(h)({
      exchangeId: exId,
      actingMemberId: alice,
    });
    expect(result.isOk).toBe(true);
    expect(h.events.names()).toEqual(["DisputeRaised"]);
    expect((await h.repo.findById(exId))?.status).toBe("disputed");
  });

  it("delegates wrong-party rejection to the aggregate", async () => {
    await seedAccepted(h.repo);
    const result = await makeRaiseDispute(h)({
      exchangeId: exId,
      actingMemberId: eve,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("WrongParty");
  });
});

describe("makeConfirmCompletion (dual confirmation)", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => (h = harness()));

  it("first confirmation keeps the exchange accepted and emits no completion events", async () => {
    await seedAccepted(h.repo);
    const result = await makeConfirmCompletion(h)({
      exchangeId: exId,
      actingMemberId: alice,
    });
    expect(result.isOk).toBe(true);
    expect((await h.repo.findById(exId))?.status).toBe("accepted");
    expect(h.events.published).toHaveLength(0);
  });

  it("second confirmation completes and publishes ExchangeCompleted + PossessionTransferred", async () => {
    await seedAccepted(h.repo);
    const confirm = makeConfirmCompletion(h);

    await confirm({ exchangeId: exId, actingMemberId: alice });
    h.clock.set(LATER); // second confirmation happens later
    const result = await confirm({ exchangeId: exId, actingMemberId: bob });

    expect(result.isOk).toBe(true);
    expect((await h.repo.findById(exId))?.status).toBe("completed");
    // the seeded exchange is a lend → possession (not ownership) of the requested copy moves
    expect(h.events.names()).toEqual([
      "ExchangeCompleted",
      "PossessionTransferred",
    ]);
  });

  it("returns ExchangeNotFound when no exchange exists", async () => {
    const result = await makeConfirmCompletion(h)({
      exchangeId: exId,
      actingMemberId: alice,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ExchangeNotFound");
  });

  it("delegates illegal-transition rejection (confirming a proposed exchange)", async () => {
    await seedProposed(h.repo);
    const result = await makeConfirmCompletion(h)({
      exchangeId: exId,
      actingMemberId: alice,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("IllegalTransition");
  });

  // The settlement guard: a stale exchange never settles, so no copy moves away from someone the
  // deal wasn't made with.
  describe("refuses once a copy is no longer where the deal was made", () => {
    const confirm = (by: MemberId) =>
      makeConfirmCompletion(h)({ exchangeId: exId, actingMemberId: by });

    it("the settling confirmation: RecipientNotOwner, nothing saved or published", async () => {
      await seedAccepted(h.repo);
      expect((await confirm(alice)).isOk).toBe(true);
      h.copies.seed(copyView(requestedId, eve)); // bob sold it to eve meanwhile
      h.clock.set(LATER);

      const result = await confirm(bob);

      expect(result.isErr && result.error.code).toBe("RecipientNotOwner");
      expect(h.events.published).toHaveLength(0);
      const stored = (await h.repo.findById(exId))?.toState();
      expect(stored?.status).toBe("accepted");
      expect(stored?.recipientConfirmationTimestamp).toBeUndefined();
    });

    it("a lone confirmation too: it could never settle", async () => {
      await seedAccepted(h.repo);
      h.copies.seed(copyView(requestedId, eve));
      const result = await confirm(alice);
      expect(result.isErr && result.error.code).toBe("RecipientNotOwner");
      expect(
        (await h.repo.findById(exId))?.toState().initiatorConfirmationTimestamp,
      ).toBeUndefined();
    });

    it("a swap whose offered copy has another owner than recorded: OfferedCopyNotOwned", async () => {
      await seedProposedSwap(h.repo, carol);
      h.copies.seed(copyView(offeredId, carol, [alice]));
      await acceptStored(h.repo);
      await confirm(alice);
      h.copies.seed(copyView(offeredId, eve, [alice]));

      const result = await confirm(bob);

      expect(result.isErr && result.error.code).toBe("OfferedCopyNotOwned");
      expect((await h.repo.findById(exId))?.status).toBe("accepted");
      expect(h.events.published).toHaveLength(0);
    });

    it("settles a swap while both copies are still in place", async () => {
      await seedProposedSwap(h.repo, alice);
      h.copies.seed(copyView(offeredId, alice));
      await acceptStored(h.repo);
      await confirm(alice);
      expect((await confirm(bob)).isOk).toBe(true);
      expect((await h.repo.findById(exId))?.status).toBe("completed");
      expect(h.events.names()).toEqual([
        "ExchangeCompleted",
        "OwnershipTransferred",
        "OwnershipTransferred",
      ]);
    });
  });
});

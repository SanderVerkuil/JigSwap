import { beforeEach, describe, expect, it } from "vitest";
import { toId } from "../../../shared-kernel";
import { CopyId, ExchangeTermsInput, MemberId, Money } from "../../domain";
import { CopyView } from "../ports/out/copy.port";
import {
  FakeCopyPort,
  FixedClock,
  InMemoryExchangeRepository,
  RecordingEventPublisher,
  SequentialIdGenerator,
} from "../testing";
import { makeProposeExchange } from "./propose-exchange";

const alice = toId<"MemberId">("alice") as MemberId; // initiator
const bob = toId<"MemberId">("bob") as MemberId; // recipient
const requestedId = toId<"CopyId">("requested") as CopyId;
const offeredId = toId<"CopyId">("offered") as CopyId;
const NOW = new Date("2026-06-08T10:00:00Z");

const price = (): Money => {
  const m = Money.create(2500, "EUR");
  if (!m.isOk) throw new Error("setup");
  return m.value;
};

// A copy with all availability flags off; tests turn on exactly what they need.
const copy = (over: Partial<CopyView> & Pick<CopyView, "id" | "ownerId">): CopyView => ({
  availability: { forTrade: false, forSale: false, forLend: false },
  ...over,
});

describe("makeProposeExchange", () => {
  let repo: InMemoryExchangeRepository;
  let copies: FakeCopyPort;
  let events: RecordingEventPublisher;
  let propose: ReturnType<typeof makeProposeExchange>;

  beforeEach(() => {
    repo = new InMemoryExchangeRepository();
    copies = new FakeCopyPort();
    events = new RecordingEventPublisher();
    propose = makeProposeExchange({
      exchanges: repo,
      copies,
      ids: new SequentialIdGenerator(),
      events,
      clock: new FixedClock(NOW),
    });
  });

  const swapTerms: ExchangeTermsInput = { kind: "swap", offeredCopyId: offeredId };
  const saleTerms = (): ExchangeTermsInput => ({ kind: "sale", price: price() });
  const lendTerms: ExchangeTermsInput = {
    kind: "lend",
    returnDate: new Date("2026-06-20T10:00:00Z"),
  };

  it("proposes a swap, saving state and publishing ExchangeProposed", async () => {
    copies
      .seed(copy({ id: requestedId, ownerId: bob, availability: { forTrade: true, forSale: false, forLend: false } }))
      .seed(copy({ id: offeredId, ownerId: alice }));

    const result = await propose({
      initiatorId: alice,
      recipientId: bob,
      kind: "swap",
      requestedCopyId: requestedId,
      terms: swapTerms,
    });

    expect(result.isOk).toBe(true);
    expect(repo.size()).toBe(1);
    expect(events.names()).toEqual(["ExchangeProposed"]);
  });

  it("rejects a duplicate active proposal for the same requested copy", async () => {
    copies
      .seed(copy({ id: requestedId, ownerId: bob, availability: { forTrade: true, forSale: false, forLend: false } }))
      .seed(copy({ id: offeredId, ownerId: alice }));
    const cmd = {
      initiatorId: alice,
      recipientId: bob,
      kind: "swap" as const,
      requestedCopyId: requestedId,
      terms: swapTerms,
    };
    expect((await propose(cmd)).isOk).toBe(true);

    const second = await propose(cmd);
    expect(second.isErr).toBe(true);
    if (second.isErr) expect(second.error.code).toBe("DuplicateProposal");
    expect(repo.size()).toBe(1); // no second exchange written
  });

  it("rejects when the requested copy does not exist", async () => {
    const result = await propose({
      initiatorId: alice,
      recipientId: bob,
      kind: "sale",
      requestedCopyId: requestedId,
      terms: saleTerms(),
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("CopyNotFound");
    expect(events.published).toHaveLength(0);
  });

  // The CORRECTED availability direction: available ⇒ ok, unavailable ⇒ reject.
  describe("availability is checked per kind (corrected direction)", () => {
    it.each<["swap" | "sale" | "lend", keyof CopyView["availability"]]>([
      ["swap", "forTrade"],
      ["sale", "forSale"],
      ["lend", "forLend"],
    ])("%s proceeds only when %s is true", async (kind, flag) => {
      const terms: ExchangeTermsInput =
        kind === "swap" ? swapTerms : kind === "sale" ? saleTerms() : lendTerms;

      // available ⇒ ok
      const available = new FakeCopyPort()
        .seed(copy({ id: requestedId, ownerId: bob, availability: { forTrade: false, forSale: false, forLend: false, [flag]: true } }))
        .seed(copy({ id: offeredId, ownerId: alice }));
      const okEvents = new RecordingEventPublisher();
      const proposeOk = makeProposeExchange({
        exchanges: new InMemoryExchangeRepository(),
        copies: available,
        ids: new SequentialIdGenerator(),
        events: okEvents,
        clock: new FixedClock(NOW),
      });
      const okRes = await proposeOk({ initiatorId: alice, recipientId: bob, kind, requestedCopyId: requestedId, terms });
      expect(okRes.isOk).toBe(true);
      expect(okEvents.names()).toEqual(["ExchangeProposed"]);

      // unavailable ⇒ reject
      const unavailable = new FakeCopyPort()
        .seed(copy({ id: requestedId, ownerId: bob }))
        .seed(copy({ id: offeredId, ownerId: alice }));
      const proposeReject = makeProposeExchange({
        exchanges: new InMemoryExchangeRepository(),
        copies: unavailable,
        ids: new SequentialIdGenerator(),
        events: new RecordingEventPublisher(),
        clock: new FixedClock(NOW),
      });
      const rejectRes = await proposeReject({ initiatorId: alice, recipientId: bob, kind, requestedCopyId: requestedId, terms });
      expect(rejectRes.isErr).toBe(true);
      if (rejectRes.isErr) expect(rejectRes.error.code).toBe("CopyNotAvailable");
    });
  });

  it("rejects a swap whose offered copy is not owned by the initiator", async () => {
    copies
      .seed(copy({ id: requestedId, ownerId: bob, availability: { forTrade: true, forSale: false, forLend: false } }))
      .seed(copy({ id: offeredId, ownerId: bob })); // offered owned by recipient, not initiator

    const result = await propose({
      initiatorId: alice,
      recipientId: bob,
      kind: "swap",
      requestedCopyId: requestedId,
      terms: swapTerms,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("OfferedCopyNotOwned");
  });

  it("rejects a swap whose offered copy does not exist", async () => {
    copies.seed(copy({ id: requestedId, ownerId: bob, availability: { forTrade: true, forSale: false, forLend: false } }));

    const result = await propose({
      initiatorId: alice,
      recipientId: bob,
      kind: "swap",
      requestedCopyId: requestedId,
      terms: swapTerms,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("CopyNotFound");
  });

  it("delegates self-exchange rejection to the aggregate", async () => {
    copies.seed(copy({ id: requestedId, ownerId: alice, availability: { forTrade: false, forSale: true, forLend: false } }));

    const result = await propose({
      initiatorId: alice,
      recipientId: alice,
      kind: "sale",
      requestedCopyId: requestedId,
      terms: saleTerms(),
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("SelfExchange");
    expect(events.published).toHaveLength(0);
  });
});

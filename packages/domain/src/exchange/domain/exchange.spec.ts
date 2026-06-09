import { beforeEach, describe, expect, it } from "vitest";
import { DomainEvent, toId } from "../../shared-kernel";
import { ExchangeCompleted, ExchangeProposed, OwnershipTransferred } from "./events";
import { Exchange, ProposeProps } from "./exchange";
import { CopyId, ExchangeId, MemberId } from "./ids";
import { ExchangeTermsInput, Money } from "./terms";

const exchangeId = toId<"ExchangeId">("ex1") as ExchangeId;
const alice = toId<"MemberId">("alice") as MemberId; // initiator
const bob = toId<"MemberId">("bob") as MemberId; // recipient
const requested = toId<"CopyId">("requested") as CopyId;
const offered = toId<"CopyId">("offered") as CopyId;
const NOW = new Date("2026-06-08T10:00:00Z");
const LATER = new Date("2026-06-09T10:00:00Z");

const price = (): Money => {
  const m = Money.create(2500, "EUR");
  if (!m.isOk) throw new Error("setup");
  return m.value;
};

const propose = (
  terms: ExchangeTermsInput,
  overrides: Partial<ProposeProps> = {},
): Exchange => {
  const result = Exchange.propose({
    id: exchangeId,
    initiator: alice,
    recipient: bob,
    requestedCopyId: requested,
    terms,
    now: NOW,
    ...overrides,
  });
  if (!result.isOk) throw new Error(`setup failed: ${result.error.message}`);
  return result.value;
};

const swapTerms: ExchangeTermsInput = { kind: "swap", offeredCopyId: offered };
const saleTerms = (): ExchangeTermsInput => ({ kind: "sale", price: price() });
const lendTerms: ExchangeTermsInput = { kind: "lend", returnDate: LATER };

const names = (events: readonly DomainEvent[]): string[] => events.map((e) => e.name);

// Drive an exchange to `accepted` and clear the proposal/accept events.
const accepted = (terms: ExchangeTermsInput = swapTerms): Exchange => {
  const ex = propose(terms);
  const r = ex.accept(bob, NOW);
  expect(r.isOk).toBe(true);
  ex.pullEvents();
  return ex;
};

describe("Exchange.propose", () => {
  it("rejects a self-exchange (initiator === recipient)", () => {
    const result = Exchange.propose({
      id: exchangeId,
      initiator: alice,
      recipient: alice,
      requestedCopyId: requested,
      terms: swapTerms,
      now: NOW,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("SelfExchange");
  });

  it.each<[string, ExchangeTermsInput]>([
    ["swap without offered copy", { kind: "swap" }],
    ["sale without price", { kind: "sale" }],
    ["lend without return date", { kind: "lend" }],
  ])("rejects %s with MissingTerms", (_label, terms) => {
    const result = Exchange.propose({
      id: exchangeId,
      initiator: alice,
      recipient: bob,
      requestedCopyId: requested,
      terms,
      now: NOW,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("MissingTerms");
  });

  it("starts proposed and records ExchangeProposed carrying parties and kind", () => {
    const ex = propose(swapTerms);
    expect(ex.status).toBe("proposed");
    expect(ex.kind).toBe("swap");
    const events = ex.pullEvents();
    expect(names(events)).toEqual(["ExchangeProposed"]);
    const proposed = events[0] as ExchangeProposed;
    expect(proposed.initiator).toBe(alice);
    expect(proposed.recipient).toBe(bob);
    expect(proposed.kind).toBe("swap");
    expect(proposed.occurredAt).toBe(NOW);
  });

  it("captures kind-specific terms into state, tagged with the matching kind", () => {
    const swap = propose(swapTerms).toState();
    expect(swap.kind).toBe("swap");
    expect(swap.offeredCopyId).toBe(offered);

    const sale = propose(saleTerms()).toState();
    expect(sale.kind).toBe("sale");
    expect(sale.price?.amountCents).toBe(2500);

    const lend = propose(lendTerms).toState();
    expect(lend.kind).toBe("lend");
    expect(lend.returnDate).toBe(LATER);
  });
});

describe("accept", () => {
  it("lets the recipient accept a proposed exchange", () => {
    const ex = propose(swapTerms);
    ex.pullEvents();
    const r = ex.accept(bob, LATER);
    expect(r.isOk).toBe(true);
    expect(ex.status).toBe("accepted");
    expect(names(ex.pullEvents())).toEqual(["ExchangeAccepted"]);
  });

  it("rejects acceptance by the initiator (wrong party)", () => {
    const ex = propose(swapTerms);
    const r = ex.accept(alice, NOW);
    expect(r.isErr).toBe(true);
    if (r.isErr) {
      expect(r.error.code).toBe("WrongParty");
      // The action name is interpolated into the message; assert it so the per-action
      // string passed to requireParty is pinned (each guard names its own action).
      expect(r.error.message).toBe("Acting member may not accept");
    }
    expect(ex.status).toBe("proposed");
  });

  it("rejects acceptance by an unrelated member", () => {
    const ex = propose(swapTerms);
    const r = ex.accept(toId<"MemberId">("eve") as MemberId, NOW);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("WrongParty");
  });

  it("rejects accept from a non-proposed status (illegal transition)", () => {
    const ex = accepted();
    const r = ex.accept(bob, NOW);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("IllegalTransition");
  });
});

describe("decline", () => {
  it("lets the recipient decline, moving to rejected", () => {
    const ex = propose(swapTerms);
    ex.pullEvents();
    const r = ex.decline(bob, NOW);
    expect(r.isOk).toBe(true);
    expect(ex.status).toBe("rejected");
    expect(names(ex.pullEvents())).toEqual(["ExchangeRejected"]);
  });

  it("rejects decline by the initiator", () => {
    const ex = propose(swapTerms);
    const r = ex.decline(alice, NOW);
    expect(r.isErr).toBe(true);
    if (r.isErr) {
      expect(r.error.code).toBe("WrongParty");
      expect(r.error.message).toBe("Acting member may not decline");
    }
  });

  it("cannot decline an already accepted exchange", () => {
    const ex = accepted();
    const r = ex.decline(bob, NOW);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("IllegalTransition");
  });
});

describe("cancel", () => {
  it("lets the initiator cancel a proposed exchange", () => {
    const ex = propose(swapTerms);
    ex.pullEvents();
    const r = ex.cancel(alice, NOW);
    expect(r.isOk).toBe(true);
    expect(ex.status).toBe("cancelled");
    expect(names(ex.pullEvents())).toEqual(["ExchangeCancelled"]);
  });

  it("lets the initiator cancel an accepted exchange", () => {
    const ex = accepted();
    const r = ex.cancel(alice, NOW);
    expect(r.isOk).toBe(true);
    expect(ex.status).toBe("cancelled");
  });

  it("rejects cancel by the recipient (wrong party)", () => {
    const ex = propose(swapTerms);
    const r = ex.cancel(bob, NOW);
    expect(r.isErr).toBe(true);
    if (r.isErr) {
      expect(r.error.code).toBe("WrongParty");
      expect(r.error.message).toBe("Acting member may not cancel");
    }
  });

  it("cannot cancel a completed exchange", () => {
    const ex = accepted();
    ex.confirmCompletion(alice, NOW);
    ex.confirmCompletion(bob, NOW);
    const r = ex.cancel(alice, NOW);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("IllegalTransition");
  });
});

describe("confirmCompletion (dual confirmation)", () => {
  it("a single confirmation does NOT complete the exchange", () => {
    const ex = accepted();
    const r = ex.confirmCompletion(alice, NOW);
    expect(r.isOk).toBe(true);
    expect(ex.status).toBe("accepted");
    expect(ex.pullEvents()).toHaveLength(0);
    expect(ex.toState().initiatorConfirmationTimestamp).toBe(NOW);
    expect(ex.toState().recipientConfirmationTimestamp).toBeUndefined();
  });

  it("both confirmations (any order) complete the exchange", () => {
    const ex = accepted();
    ex.confirmCompletion(bob, NOW);
    expect(ex.status).toBe("accepted");
    const r = ex.confirmCompletion(alice, LATER);
    expect(r.isOk).toBe(true);
    expect(ex.status).toBe("completed");
  });

  it("a repeated confirmation by the same party does not complete", () => {
    const ex = accepted();
    ex.confirmCompletion(alice, NOW);
    const r = ex.confirmCompletion(alice, LATER);
    expect(r.isOk).toBe(true);
    expect(ex.status).toBe("accepted");
  });

  it("rejects confirmation by an unrelated member", () => {
    const ex = accepted();
    const r = ex.confirmCompletion(toId<"MemberId">("eve") as MemberId, NOW);
    expect(r.isErr).toBe(true);
    if (r.isErr) {
      expect(r.error.code).toBe("WrongParty");
      expect(r.error.message).toBe("Acting member may not confirm completion");
    }
  });

  it("cannot confirm completion from a proposed exchange (illegal transition)", () => {
    const ex = propose(swapTerms);
    const r = ex.confirmCompletion(alice, NOW);
    expect(r.isErr).toBe(true);
    if (r.isErr) {
      expect(r.error.code).toBe("IllegalTransition");
      expect(r.error.message).toBe("Cannot transition from proposed to completed");
    }
  });
});

describe("settlement events", () => {
  it("a swap transfers BOTH copies: requested→initiator, offered→recipient", () => {
    const ex = accepted(swapTerms);
    ex.confirmCompletion(alice, NOW);
    ex.confirmCompletion(bob, LATER);
    const events = ex.pullEvents();
    expect(names(events)).toEqual([
      "ExchangeCompleted",
      "OwnershipTransferred",
      "OwnershipTransferred",
    ]);
    const transfers = events.filter(
      (e): e is OwnershipTransferred => e.name === "OwnershipTransferred",
    );
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toMatchObject({ copyId: requested, newOwner: alice });
    expect(transfers[1]).toMatchObject({ copyId: offered, newOwner: bob });
  });

  it("a sale transfers ONLY the requested copy to the initiator", () => {
    const ex = accepted(saleTerms());
    ex.confirmCompletion(alice, NOW);
    ex.confirmCompletion(bob, LATER);
    const transfers = ex
      .pullEvents()
      .filter((e): e is OwnershipTransferred => e.name === "OwnershipTransferred");
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ copyId: requested, newOwner: alice });
  });

  it("a lend transfers ONLY the requested copy to the initiator", () => {
    const ex = accepted(lendTerms);
    ex.confirmCompletion(alice, NOW);
    ex.confirmCompletion(bob, LATER);
    const transfers = ex
      .pullEvents()
      .filter((e): e is OwnershipTransferred => e.name === "OwnershipTransferred");
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ copyId: requested, newOwner: alice });
  });

  // The second transfer is guarded by `kind === "swap" && offeredCopyId`. Rehydrating
  // hand-crafted states isolates each half of that guard (states unreachable via propose()).
  const settle = (ex: Exchange): readonly OwnershipTransferred[] => {
    ex.confirmCompletion(alice, NOW);
    ex.confirmCompletion(bob, LATER);
    return ex
      .pullEvents()
      .filter((e): e is OwnershipTransferred => e.name === "OwnershipTransferred");
  };

  const acceptedState = (
    over: Partial<ReturnType<Exchange["toState"]>>,
  ): Exchange => {
    const base = accepted(swapTerms).toState();
    return Exchange.rehydrate({ ...base, ...over });
  };

  it("does NOT transfer an offered copy when the kind is not swap, even if one is present", () => {
    // kind=sale but offeredCopyId set: the `kind === \"swap\"` half must gate it out, so the
    // `&&`→`||` and `if (true)` mutants (which would emit a second transfer) die here.
    const ex = acceptedState({ kind: "sale", offeredCopyId: offered, price: price() });
    const transfers = settle(ex);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ copyId: requested, newOwner: alice });
  });

  it("does NOT transfer a second copy for a swap missing its offered copy", () => {
    // kind=swap but no offeredCopyId: the `offeredCopyId` half must gate it out, so the
    // `if (true)` mutant dies here.
    const ex = acceptedState({ kind: "swap", offeredCopyId: undefined });
    expect(settle(ex)).toHaveLength(1);
  });

  it("records ExchangeCompleted exactly once on settlement", () => {
    const ex = accepted(saleTerms());
    ex.confirmCompletion(alice, NOW);
    ex.confirmCompletion(bob, LATER);
    const completed = ex.pullEvents().filter((e) => e.name === "ExchangeCompleted");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toBeInstanceOf(ExchangeCompleted);
  });
});

describe("raiseDispute", () => {
  it("either party can dispute an accepted exchange", () => {
    const exByRecipient = accepted();
    expect(exByRecipient.raiseDispute(bob, NOW).isOk).toBe(true);
    expect(exByRecipient.status).toBe("disputed");

    const exByInitiator = accepted();
    expect(exByInitiator.raiseDispute(alice, NOW).isOk).toBe(true);
    expect(exByInitiator.status).toBe("disputed");
    expect(names(exByInitiator.pullEvents())).toEqual(["DisputeRaised"]);
  });

  it("a completed exchange can still be disputed", () => {
    const ex = accepted();
    ex.confirmCompletion(alice, NOW);
    ex.confirmCompletion(bob, LATER);
    ex.pullEvents();
    const r = ex.raiseDispute(alice, LATER);
    expect(r.isOk).toBe(true);
    expect(ex.status).toBe("disputed");
  });

  it("rejects a dispute from an unrelated member", () => {
    const ex = accepted();
    const r = ex.raiseDispute(toId<"MemberId">("eve") as MemberId, NOW);
    expect(r.isErr).toBe(true);
    if (r.isErr) {
      expect(r.error.code).toBe("WrongParty");
      expect(r.error.message).toBe("Acting member may not raise a dispute");
    }
  });

  it("cannot dispute a proposed exchange (illegal transition)", () => {
    const ex = propose(swapTerms);
    const r = ex.raiseDispute(alice, NOW);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("IllegalTransition");
  });
});

describe("terminal states reject all moves", () => {
  let rejected: Exchange;
  let cancelled: Exchange;

  beforeEach(() => {
    rejected = propose(swapTerms);
    rejected.decline(bob, NOW);
    cancelled = propose(swapTerms);
    cancelled.cancel(alice, NOW);
  });

  it("a rejected exchange cannot be accepted or cancelled", () => {
    expect(rejected.accept(bob, NOW).isErr).toBe(true);
    expect(rejected.cancel(alice, NOW).isErr).toBe(true);
  });

  it("a cancelled exchange cannot be accepted or disputed", () => {
    expect(cancelled.accept(bob, NOW).isErr).toBe(true);
    expect(cancelled.raiseDispute(alice, NOW).isErr).toBe(true);
  });
});

describe("rehydrate / toState round-trip", () => {
  it("rehydrates from a persisted state without re-recording events", () => {
    const original = propose(saleTerms());
    const state = original.toState();
    const restored = Exchange.rehydrate(state);
    expect(restored.pullEvents()).toHaveLength(0);
    expect(restored.toState()).toEqual(state);
    expect(restored.status).toBe("proposed");
  });

  it("a rehydrated accepted exchange can still be driven to completion", () => {
    const ex = accepted(lendTerms);
    const restored = Exchange.rehydrate(ex.toState());
    restored.confirmCompletion(alice, NOW);
    const r = restored.confirmCompletion(bob, LATER);
    expect(r.isOk).toBe(true);
    expect(restored.status).toBe("completed");
  });
});

describe("pullEvents", () => {
  it("clears the buffer so events are not emitted twice", () => {
    const ex = propose(swapTerms);
    expect(ex.pullEvents()).toHaveLength(1);
    expect(ex.pullEvents()).toHaveLength(0);
  });
});

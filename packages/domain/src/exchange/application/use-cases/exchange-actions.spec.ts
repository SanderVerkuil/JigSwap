import { beforeEach, describe, expect, it } from "vitest";
import { toId } from "../../../shared-kernel";
import { CopyId, Exchange, ExchangeId, MemberId } from "../../domain";
import {
  FixedClock,
  InMemoryExchangeRepository,
  RecordingEventPublisher,
} from "../testing";
import { makeAcceptExchange } from "./accept-exchange";
import { makeCancelExchange } from "./cancel-exchange";
import { makeConfirmCompletion } from "./confirm-completion";
import { makeDeclineExchange } from "./decline-exchange";
import { makeRaiseDispute } from "./raise-dispute";

const alice = toId<"MemberId">("alice") as MemberId; // initiator
const bob = toId<"MemberId">("bob") as MemberId; // recipient
const eve = toId<"MemberId">("eve") as MemberId; // outsider
const requestedId = toId<"CopyId">("requested") as CopyId;
const exId = toId<"ExchangeId">("ex-1") as ExchangeId;
const NOW = new Date("2026-06-08T10:00:00Z");
const LATER = new Date("2026-06-09T10:00:00Z");

// A proposed swap exchange, persisted, ready for a lifecycle action.
const seedProposed = async (repo: InMemoryExchangeRepository): Promise<void> => {
  const result = Exchange.propose({
    id: exId,
    initiator: alice,
    recipient: bob,
    requestedCopyId: requestedId,
    terms: { kind: "lend", returnDate: LATER },
    now: NOW,
  });
  if (!result.isOk) throw new Error("setup");
  result.value.pullEvents();
  await repo.save(result.value);
};

const seedAccepted = async (repo: InMemoryExchangeRepository): Promise<void> => {
  await seedProposed(repo);
  const ex = await repo.findById(exId);
  if (!ex) throw new Error("setup");
  ex.accept(bob, NOW);
  ex.pullEvents();
  await repo.save(ex);
};

const harness = () => {
  const repo = new InMemoryExchangeRepository();
  const events = new RecordingEventPublisher();
  const clock = new FixedClock(NOW);
  return { repo, events, clock, exchanges: repo };
};

describe("makeAcceptExchange", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => (h = harness()));

  it("accepts a proposed exchange, persisting and publishing ExchangeAccepted", async () => {
    await seedProposed(h.repo);
    const result = await makeAcceptExchange(h)({ exchangeId: exId, actingMemberId: bob });
    expect(result.isOk).toBe(true);
    expect(h.events.names()).toEqual(["ExchangeAccepted"]);
    expect((await h.repo.findById(exId))?.status).toBe("accepted");
  });

  it("returns ExchangeNotFound when no exchange exists", async () => {
    const result = await makeAcceptExchange(h)({ exchangeId: exId, actingMemberId: bob });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ExchangeNotFound");
  });

  it("delegates wrong-party rejection to the aggregate", async () => {
    await seedProposed(h.repo);
    const result = await makeAcceptExchange(h)({ exchangeId: exId, actingMemberId: alice });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("WrongParty");
    expect(h.events.published).toHaveLength(0);
  });

  it("delegates illegal-transition rejection to the aggregate", async () => {
    await seedAccepted(h.repo);
    const result = await makeAcceptExchange(h)({ exchangeId: exId, actingMemberId: bob });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("IllegalTransition");
  });
});

describe("makeDeclineExchange", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => (h = harness()));

  it("declines a proposed exchange, publishing ExchangeRejected", async () => {
    await seedProposed(h.repo);
    const result = await makeDeclineExchange(h)({ exchangeId: exId, actingMemberId: bob });
    expect(result.isOk).toBe(true);
    expect(h.events.names()).toEqual(["ExchangeRejected"]);
    expect((await h.repo.findById(exId))?.status).toBe("rejected");
  });

  it("returns ExchangeNotFound when no exchange exists", async () => {
    const result = await makeDeclineExchange(h)({ exchangeId: exId, actingMemberId: bob });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ExchangeNotFound");
  });
});

describe("makeCancelExchange", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => (h = harness()));

  it("lets the initiator cancel, publishing ExchangeCancelled", async () => {
    await seedProposed(h.repo);
    const result = await makeCancelExchange(h)({ exchangeId: exId, actingMemberId: alice });
    expect(result.isOk).toBe(true);
    expect(h.events.names()).toEqual(["ExchangeCancelled"]);
    expect((await h.repo.findById(exId))?.status).toBe("cancelled");
  });

  it("delegates wrong-party rejection to the aggregate", async () => {
    await seedProposed(h.repo);
    const result = await makeCancelExchange(h)({ exchangeId: exId, actingMemberId: bob });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("WrongParty");
  });
});

describe("makeRaiseDispute", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => (h = harness()));

  it("lets a party dispute an accepted exchange, publishing DisputeRaised", async () => {
    await seedAccepted(h.repo);
    const result = await makeRaiseDispute(h)({ exchangeId: exId, actingMemberId: alice });
    expect(result.isOk).toBe(true);
    expect(h.events.names()).toEqual(["DisputeRaised"]);
    expect((await h.repo.findById(exId))?.status).toBe("disputed");
  });

  it("delegates wrong-party rejection to the aggregate", async () => {
    await seedAccepted(h.repo);
    const result = await makeRaiseDispute(h)({ exchangeId: exId, actingMemberId: eve });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("WrongParty");
  });
});

describe("makeConfirmCompletion (dual confirmation)", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => (h = harness()));

  it("first confirmation keeps the exchange accepted and emits no completion events", async () => {
    await seedAccepted(h.repo);
    const result = await makeConfirmCompletion(h)({ exchangeId: exId, actingMemberId: alice });
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
    expect(h.events.names()).toEqual(["ExchangeCompleted", "PossessionTransferred"]);
  });

  it("returns ExchangeNotFound when no exchange exists", async () => {
    const result = await makeConfirmCompletion(h)({ exchangeId: exId, actingMemberId: alice });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ExchangeNotFound");
  });

  it("delegates illegal-transition rejection (confirming a proposed exchange)", async () => {
    await seedProposed(h.repo);
    const result = await makeConfirmCompletion(h)({ exchangeId: exId, actingMemberId: alice });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("IllegalTransition");
  });
});

import { describe, expect, it } from "vitest";
import { toConnectionOfferId, toMemberId } from "../../shared-kernel";
import { CONNECTION_OFFER_TTL_MS, ConnectionOffer } from "./connection-offer";

const inviter = toMemberId("alice");
const newcomer = toMemberId("bob");
const stranger = toMemberId("carol");
const offerId = toConnectionOfferId("offer-1");
const NOW = new Date("2026-10-18T10:00:00Z");
const LATER = new Date("2026-10-19T10:00:00Z");
const EXPIRES = new Date(NOW.getTime() + CONNECTION_OFFER_TTL_MS);
const JUST_BEFORE_EXPIRY = new Date(EXPIRES.getTime() - 1);

const pending = () => {
  const result = ConnectionOffer.offer({
    id: offerId,
    fromId: inviter,
    toId: newcomer,
    source: "inviteLink",
    now: NOW,
  });
  if (!result.isOk) throw new Error("setup");
  result.value.pullEvents();
  return result.value;
};

describe("ConnectionOffer.offer", () => {
  it("creates a pending offer that expires 30 days later", () => {
    const result = ConnectionOffer.offer({
      id: offerId,
      fromId: inviter,
      toId: newcomer,
      source: "householdLink",
      now: NOW,
    });
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    const offer = result.value;
    expect(CONNECTION_OFFER_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(offer.id).toBe(offerId);
    expect(offer.fromId).toBe(inviter);
    expect(offer.toId).toBe(newcomer);
    expect(offer.status).toBe("pending");
    expect(offer.toState()).toEqual({
      id: offerId,
      fromId: inviter,
      toId: newcomer,
      source: "householdLink",
      status: "pending",
      createdAt: NOW,
      expiresAt: EXPIRES,
    });
  });

  it("records ConnectionOffered with the pair and source, drained once", () => {
    const result = ConnectionOffer.offer({
      id: offerId,
      fromId: inviter,
      toId: newcomer,
      source: "inviteLink",
      now: NOW,
    });
    if (!result.isOk) throw new Error("setup");
    const events = result.value.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "ConnectionOffered",
      offerId,
      fromId: inviter,
      toId: newcomer,
      source: "inviteLink",
      occurredAt: NOW,
    });
    expect(result.value.pullEvents()).toHaveLength(0);
  });

  it("rejects an offer to oneself", () => {
    const result = ConnectionOffer.offer({
      id: offerId,
      fromId: inviter,
      toId: inviter,
      source: "inviteLink",
      now: NOW,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("SelfFollow");
  });
});

describe("ConnectionOffer.isOpen", () => {
  it("is open while pending and before expiry", () => {
    expect(pending().isOpen(JUST_BEFORE_EXPIRY)).toBe(true);
  });

  it("is closed at the expiry instant", () => {
    expect(pending().isOpen(EXPIRES)).toBe(false);
  });

  it("is closed once answered", () => {
    const offer = pending();
    offer.decline(newcomer, LATER);
    expect(offer.isOpen(LATER)).toBe(false);
  });
});

describe.each(["accept", "decline"] as const)("ConnectionOffer.%s", (op) => {
  const expected = op === "accept" ? "accepted" : "declined";

  it(`moves pending → ${expected} and stamps respondedAt, recording no event`, () => {
    const offer = pending();
    const result = offer[op](newcomer, LATER);
    expect(result.isOk).toBe(true);
    expect(offer.status).toBe(expected);
    expect(offer.toState().respondedAt).toBe(LATER);
    expect(offer.pullEvents()).toHaveLength(0);
  });

  it("is allowed just before expiry", () => {
    expect(pending()[op](newcomer, JUST_BEFORE_EXPIRY).isOk).toBe(true);
  });

  it("refuses anyone but the recipient, even the inviter", () => {
    for (const actor of [inviter, stranger]) {
      const offer = pending();
      const result = offer[op](actor, LATER);
      expect(result.isErr).toBe(true);
      if (result.isErr) {
        expect(result.error.code).toBe("NotConnectionOfferRecipient");
      }
      expect(offer.status).toBe("pending");
    }
  });

  it("refuses an offer that is no longer pending", () => {
    const offer = pending();
    offer.accept(newcomer, LATER);
    const result = offer[op](newcomer, LATER);
    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.code).toBe("ConnectionOfferNotPending");
    }
    expect(offer.status).toBe("accepted");
  });

  it("refuses a pending offer at or past its expiry", () => {
    const offer = pending();
    const result = offer[op](newcomer, EXPIRES);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ConnectionOfferExpired");
    expect(offer.status).toBe("pending");
    expect(offer.toState().respondedAt).toBeUndefined();
  });
});

describe("ConnectionOffer.expire", () => {
  it("expires a pending offer at its expiry instant", () => {
    const offer = pending();
    expect(offer.expire(EXPIRES).isOk).toBe(true);
    expect(offer.status).toBe("expired");
    expect(offer.toState().respondedAt).toBeUndefined();
  });

  it("refuses to expire before the expiry instant", () => {
    const offer = pending();
    const result = offer.expire(JUST_BEFORE_EXPIRY);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ConnectionOfferNotDue");
    expect(offer.status).toBe("pending");
  });

  it("leaves an answered offer alone", () => {
    const offer = pending();
    offer.decline(newcomer, LATER);
    const result = offer.expire(EXPIRES);
    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.code).toBe("ConnectionOfferNotPending");
    }
    expect(offer.status).toBe("declined");
  });
});

describe("ConnectionOffer.rehydrate", () => {
  it("round-trips its state", () => {
    const state = pending().toState();
    expect(ConnectionOffer.rehydrate(state).toState()).toBe(state);
  });
});

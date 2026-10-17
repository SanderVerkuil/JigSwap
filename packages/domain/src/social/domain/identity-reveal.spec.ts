import { describe, expect, it } from "vitest";
import { toMemberId } from "../../shared-kernel";
import {
  exchangeIdentityReveals,
  ownerActedInHistory,
  ownerActedOnTrigger,
} from "./identity-reveal";

const requester = toMemberId("requester");
const owner = toMemberId("owner");
const stranger = toMemberId("stranger");

describe("exchangeIdentityReveals", () => {
  it("reveals only the requester to the owner while the owner has not acted", () => {
    expect(
      exchangeIdentityReveals({
        initiator: requester,
        recipient: owner,
        ownerActed: false,
      }),
    ).toEqual([{ viewer: owner, target: requester }]);
  });

  it("also reveals the owner to the requester once the owner acted", () => {
    expect(
      exchangeIdentityReveals({
        initiator: requester,
        recipient: owner,
        ownerActed: true,
      }),
    ).toEqual([
      { viewer: owner, target: requester },
      { viewer: requester, target: owner },
    ]);
  });

  it("grants nothing for a self-exchange", () => {
    expect(
      exchangeIdentityReveals({
        initiator: owner,
        recipient: owner,
        ownerActed: true,
      }),
    ).toEqual([]);
  });
});

describe("ownerActedOnTrigger", () => {
  it("treats accepting as the owner acting", () => {
    expect(ownerActedOnTrigger({ kind: "ExchangeAccepted" }, owner)).toBe(true);
  });

  it("never treats proposing as the owner acting", () => {
    expect(ownerActedOnTrigger({ kind: "ExchangeProposed" }, owner)).toBe(
      false,
    );
  });

  it("treats a message authored by the owner as the owner acting", () => {
    expect(
      ownerActedOnTrigger(
        { kind: "ExchangeMessagePosted", authorId: owner },
        owner,
      ),
    ).toBe(true);
  });

  it("ignores messages from the requester, anyone else, or the system", () => {
    for (const authorId of [requester, stranger, null]) {
      expect(
        ownerActedOnTrigger({ kind: "ExchangeMessagePosted", authorId }, owner),
      ).toBe(false);
    }
  });
});

describe("ownerActedInHistory", () => {
  const none = { ownerAuthoredMessage: false, acceptedLifecycleMessage: false };

  it("treats post-accept statuses as proof the owner acted", () => {
    for (const status of ["accepted", "completed", "disputed"]) {
      expect(ownerActedInHistory({ status, ...none })).toBe(true);
    }
  });

  it("fails closed for pre-accept or ambiguous statuses without evidence", () => {
    for (const status of ["proposed", "rejected", "cancelled"]) {
      expect(ownerActedInHistory({ status, ...none })).toBe(false);
    }
  });

  it("accepts an owner-authored message as evidence", () => {
    expect(
      ownerActedInHistory({
        status: "cancelled",
        ownerAuthoredMessage: true,
        acceptedLifecycleMessage: false,
      }),
    ).toBe(true);
  });

  it("accepts the accepted-lifecycle system message as evidence", () => {
    expect(
      ownerActedInHistory({
        status: "cancelled",
        ownerAuthoredMessage: false,
        acceptedLifecycleMessage: true,
      }),
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { toMemberId } from "../../shared-kernel";
import {
  exchangeIdentityReveals,
  ownerActedInHistory,
  ownerActedOnTrigger,
  tradeEmailVisible,
  tradePartyState,
  tradeRevealReasonFor,
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

describe("tradeRevealReasonFor", () => {
  it("records an acceptance", () => {
    expect(tradeRevealReasonFor({ kind: "ExchangeAccepted" }, owner)).toBe(
      "accepted",
    );
  });

  it("records an owner-authored reply", () => {
    expect(
      tradeRevealReasonFor(
        { kind: "ExchangeMessagePosted", authorId: owner },
        owner,
      ),
    ).toBe("owner_replied");
  });

  it("records nothing for proposing, the requester's, a stranger's or a system message", () => {
    expect(
      tradeRevealReasonFor({ kind: "ExchangeProposed" }, owner),
    ).toBeNull();
    for (const authorId of [requester, stranger, null]) {
      expect(
        tradeRevealReasonFor(
          { kind: "ExchangeMessagePosted", authorId },
          owner,
        ),
      ).toBeNull();
    }
  });
});

describe("tradePartyState", () => {
  const base = {
    initiator: requester,
    recipient: owner,
    ownerActed: false,
    partyActive: true,
    partyVisible: false,
  };

  it("is self for the viewer's own party, even when inactive", () => {
    expect(
      tradePartyState({
        ...base,
        viewer: owner,
        party: owner,
        partyActive: false,
      }),
    ).toBe("self");
  });

  it("is departed for a gone account, before any visibility rule", () => {
    expect(
      tradePartyState({
        ...base,
        viewer: owner,
        party: requester,
        partyActive: false,
        partyVisible: true,
      }),
    ).toBe("departed");
  });

  it("is visible by the ordinary rules", () => {
    expect(
      tradePartyState({
        ...base,
        viewer: requester,
        party: owner,
        partyVisible: true,
      }),
    ).toBe("visible");
  });

  it("reveals the requester to the owner inside the trade", () => {
    expect(tradePartyState({ ...base, viewer: owner, party: requester })).toBe(
      "tradeRevealed",
    );
  });

  it("hides the owner from the requester until the owner acted", () => {
    expect(tradePartyState({ ...base, viewer: requester, party: owner })).toBe(
      "hidden",
    );
    expect(
      tradePartyState({
        ...base,
        viewer: requester,
        party: owner,
        ownerActed: true,
      }),
    ).toBe("tradeRevealed");
  });

  it("never reveals to a non-party", () => {
    for (const party of [owner, requester]) {
      expect(
        tradePartyState({
          ...base,
          viewer: stranger,
          party,
          ownerActed: true,
        }),
      ).toBe("hidden");
    }
  });
});

describe("tradeEmailVisible", () => {
  const trade = { initiator: requester, recipient: owner };

  it("shows the requester's email to the owner always", () => {
    expect(
      tradeEmailVisible({
        ...trade,
        viewer: owner,
        party: requester,
        ownerActed: false,
      }),
    ).toBe(true);
  });

  it("shows the owner's email to the requester only once the owner acted", () => {
    expect(
      tradeEmailVisible({
        ...trade,
        viewer: requester,
        party: owner,
        ownerActed: false,
      }),
    ).toBe(false);
    expect(
      tradeEmailVisible({
        ...trade,
        viewer: requester,
        party: owner,
        ownerActed: true,
      }),
    ).toBe(true);
  });

  it("never for the viewer themself or a non-party", () => {
    expect(
      tradeEmailVisible({
        ...trade,
        viewer: owner,
        party: owner,
        ownerActed: true,
      }),
    ).toBe(false);
    expect(
      tradeEmailVisible({
        ...trade,
        viewer: stranger,
        party: requester,
        ownerActed: true,
      }),
    ).toBe(false);
  });
});

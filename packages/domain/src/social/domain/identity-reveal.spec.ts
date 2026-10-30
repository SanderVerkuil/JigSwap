import { describe, expect, it } from "vitest";
import { toMemberId } from "../../shared-kernel";
import {
  tradeContactSharingOpen,
  tradeEmailVisible,
  tradePartyState,
  tradeRevealReasonFor,
  tradeRevealReasonFromHistory,
} from "./identity-reveal";

const requester = toMemberId("requester");
const owner = toMemberId("owner");
const stranger = toMemberId("stranger");

describe("tradeRevealReasonFromHistory", () => {
  const none = { ownerAuthoredMessage: false, acceptedLifecycleMessage: false };

  it("treats post-accept statuses as an acceptance", () => {
    for (const status of ["accepted", "completed", "disputed"]) {
      expect(tradeRevealReasonFromHistory({ status, ...none })).toBe(
        "accepted",
      );
    }
  });

  it("fails closed for pre-accept or ambiguous statuses without evidence", () => {
    for (const status of ["proposed", "rejected", "cancelled"]) {
      expect(tradeRevealReasonFromHistory({ status, ...none })).toBeNull();
    }
  });

  it("treats the accepted-lifecycle message as an acceptance, even with a reply", () => {
    expect(
      tradeRevealReasonFromHistory({
        status: "cancelled",
        ownerAuthoredMessage: true,
        acceptedLifecycleMessage: true,
      }),
    ).toBe("accepted");
  });

  it("treats an owner-authored message as a reply", () => {
    expect(
      tradeRevealReasonFromHistory({
        status: "rejected",
        ownerAuthoredMessage: true,
        acceptedLifecycleMessage: false,
      }),
    ).toBe("owner_replied");
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

describe("tradeContactSharingOpen", () => {
  it("is open only once the owner accepted, and never across a block", () => {
    for (const status of ["accepted", "completed", "disputed"]) {
      expect(tradeContactSharingOpen({ status, blocked: false })).toBe(true);
      expect(tradeContactSharingOpen({ status, blocked: true })).toBe(false);
    }
    for (const status of ["proposed", "rejected", "cancelled"]) {
      expect(tradeContactSharingOpen({ status, blocked: false })).toBe(false);
    }
  });
});

describe("tradeEmailVisible", () => {
  const facts = {
    viewer: requester,
    party: owner,
    status: "accepted",
    partyShared: true,
    blocked: false,
  };

  it("shows the party's email once they shared it in an accepted, completed or disputed trade", () => {
    for (const status of ["accepted", "completed", "disputed"]) {
      expect(tradeEmailVisible({ ...facts, status })).toBe(true);
    }
    // Either side: the requester's email reaches the owner the same way.
    expect(
      tradeEmailVisible({ ...facts, viewer: owner, party: requester }),
    ).toBe(true);
  });

  it("never without the party's own share, whatever the status", () => {
    for (const status of ["proposed", "accepted", "completed", "disputed"]) {
      expect(tradeEmailVisible({ ...facts, status, partyShared: false })).toBe(
        false,
      );
    }
  });

  it("hides a shared email before acceptance and after a decline or cancel", () => {
    for (const status of ["proposed", "rejected", "cancelled"]) {
      expect(tradeEmailVisible({ ...facts, status })).toBe(false);
    }
  });

  it("hides a shared email across a block", () => {
    expect(tradeEmailVisible({ ...facts, blocked: true })).toBe(false);
  });

  it("never shows a viewer their own email", () => {
    expect(tradeEmailVisible({ ...facts, viewer: owner, party: owner })).toBe(
      false,
    );
  });
});

describe("trade reveal edge cases", () => {
  it("never reveals a non-party to either party", () => {
    const trade = {
      initiator: requester,
      recipient: owner,
      ownerActed: true,
      partyActive: true,
      partyVisible: false,
      party: stranger,
    };
    for (const viewer of [owner, requester]) {
      expect(tradePartyState({ ...trade, viewer })).toBe("hidden");
    }
  });
});

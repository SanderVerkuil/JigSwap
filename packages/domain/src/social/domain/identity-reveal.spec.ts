import { describe, expect, it } from "vitest";
import { toMemberId } from "../../shared-kernel";
import {
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
      expect(tradeEmailVisible({ ...trade, viewer })).toBe(false);
    }
  });

  it("never shows a viewer their own email, even in a degenerate self-trade", () => {
    expect(
      tradeEmailVisible({
        initiator: owner,
        recipient: owner,
        viewer: owner,
        party: owner,
        ownerActed: true,
      }),
    ).toBe(false);
  });
});

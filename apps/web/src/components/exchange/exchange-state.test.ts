import { describe, expect, it } from "vitest";
import {
  confirmationState,
  needsViewerAction,
  viewerSide,
} from "./exchange-state";

describe("viewerSide", () => {
  it("puts the requester on the initiator side and the owner on the recipient side", () => {
    expect(viewerSide("outgoing")).toBe("initiator");
    expect(viewerSide("incoming")).toBe("recipient");
  });
});

describe("confirmationState", () => {
  it("reads nobody's confirmation on a fresh accepted exchange", () => {
    expect(confirmationState({}, "initiator")).toEqual({
      mineAt: undefined,
      theirsAt: undefined,
      mySettles: false,
    });
  });

  it("reads the viewer's own stamp as mine, whichever side they are on", () => {
    const exchange = { initiatorConfirmationTimestamp: 10 };
    expect(confirmationState(exchange, "initiator")).toEqual({
      mineAt: 10,
      theirsAt: undefined,
      mySettles: false,
    });
    expect(confirmationState(exchange, "recipient")).toEqual({
      mineAt: undefined,
      theirsAt: 10,
      mySettles: true,
    });
  });

  it("settles with the viewer's click only when just the partner has confirmed", () => {
    expect(
      confirmationState({ recipientConfirmationTimestamp: 20 }, "initiator")
        .mySettles,
    ).toBe(true);
    expect(
      confirmationState(
        {
          initiatorConfirmationTimestamp: 10,
          recipientConfirmationTimestamp: 20,
        },
        "initiator",
      ).mySettles,
    ).toBe(false);
  });
});

describe("needsViewerAction", () => {
  it("asks the owner to answer a pending request, not its sender", () => {
    expect(needsViewerAction({ status: "proposed" }, "incoming")).toBe(true);
    expect(needsViewerAction({ status: "proposed" }, "outgoing")).toBe(false);
  });

  it("asks either party to confirm an accepted exchange until they have", () => {
    expect(needsViewerAction({ status: "accepted" }, "outgoing")).toBe(true);
    expect(needsViewerAction({ status: "accepted" }, "incoming")).toBe(true);
    expect(
      needsViewerAction(
        { status: "accepted", initiatorConfirmationTimestamp: 10 },
        "outgoing",
      ),
    ).toBe(false);
    expect(
      needsViewerAction(
        { status: "accepted", initiatorConfirmationTimestamp: 10 },
        "incoming",
      ),
    ).toBe(true);
  });

  it("asks nothing once the exchange is closed", () => {
    for (const status of [
      "completed",
      "rejected",
      "cancelled",
      "disputed",
    ] as const) {
      expect(needsViewerAction({ status }, "incoming")).toBe(false);
      expect(needsViewerAction({ status }, "outgoing")).toBe(false);
    }
  });
});

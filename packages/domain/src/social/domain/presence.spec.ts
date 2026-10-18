import { describe, expect, it } from "vitest";
import { toMemberId } from "../../shared-kernel";
import {
  canSeePresence,
  effectiveStatus,
  type PresenceVisibilityFacts,
} from "./presence";

const viewer = toMemberId("viewer");
const target = toMemberId("target");

const visible: PresenceVisibilityFacts = {
  viewerId: viewer,
  targetId: target,
  mutual: true,
  blockedEitherWay: false,
  targetShare: true,
  targetOverride: "auto",
  viewerShare: true,
};

describe("canSeePresence", () => {
  it("shows a sharing mutual follower to a sharing viewer", () => {
    expect(canSeePresence(visible)).toBe(true);
  });

  it("shows a target whose override is away", () => {
    expect(canSeePresence({ ...visible, targetOverride: "away" })).toBe(true);
  });

  it("never shows the viewer themselves", () => {
    expect(canSeePresence({ ...visible, targetId: viewer })).toBe(false);
  });

  it("hides a pair blocked either way", () => {
    expect(canSeePresence({ ...visible, blockedEitherWay: true })).toBe(false);
  });

  it("hides a target who is not a mutual follower", () => {
    expect(canSeePresence({ ...visible, mutual: false })).toBe(false);
  });

  it.each([false, undefined])("hides a target whose share is %s", (share) => {
    expect(canSeePresence({ ...visible, targetShare: share })).toBe(false);
  });

  it("hides an invisible target", () => {
    expect(canSeePresence({ ...visible, targetOverride: "invisible" })).toBe(
      false,
    );
  });

  it.each([false, undefined])(
    "hides everyone from a viewer whose share is %s (reciprocity)",
    (share) => {
      expect(canSeePresence({ ...visible, viewerShare: share })).toBe(false);
    },
  );
});

describe("effectiveStatus", () => {
  it("is offline in neither room, whatever the override", () => {
    for (const override of ["auto", "away", "invisible"] as const) {
      expect(
        effectiveStatus({ override, inOnlineRoom: false, inAwayRoom: false }),
      ).toBe("offline");
    }
  });

  it("auto: online when in the online room", () => {
    expect(
      effectiveStatus({
        override: "auto",
        inOnlineRoom: true,
        inAwayRoom: false,
      }),
    ).toBe("online");
  });

  it("auto: online wins when in both rooms (another tab is active)", () => {
    expect(
      effectiveStatus({
        override: "auto",
        inOnlineRoom: true,
        inAwayRoom: true,
      }),
    ).toBe("online");
  });

  it("auto: away when only in the away room (idle)", () => {
    expect(
      effectiveStatus({
        override: "auto",
        inOnlineRoom: false,
        inAwayRoom: true,
      }),
    ).toBe("away");
  });

  it("away override: away whenever not offline", () => {
    expect(
      effectiveStatus({
        override: "away",
        inOnlineRoom: true,
        inAwayRoom: false,
      }),
    ).toBe("away");
    expect(
      effectiveStatus({
        override: "away",
        inOnlineRoom: false,
        inAwayRoom: true,
      }),
    ).toBe("away");
  });

  it("invisible override: offline even when online", () => {
    expect(
      effectiveStatus({
        override: "invisible",
        inOnlineRoom: true,
        inAwayRoom: true,
      }),
    ).toBe("offline");
  });
});

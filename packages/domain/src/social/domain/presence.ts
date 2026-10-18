import { MemberId } from "./ids";

// Presence (online / away): live activity, so it is shown far more narrowly than identity. Opt-in,
// mutual followers only, and reciprocal: a member who does not share sees nobody. A public profile
// or a shared circle does NOT make presence visible. Hidden and offline are indistinguishable to
// the viewer (both are simply absent).

/** The member's manual presence choice. No "online" override: the server can't claim a session. */
export type PresenceOverride = "auto" | "away" | "invisible";

export type PresenceStatus = "online" | "away" | "offline";

export interface PresenceVisibilityFacts {
  readonly viewerId: MemberId;
  readonly targetId: MemberId;
  /** Viewer and target follow each other. */
  readonly mutual: boolean;
  readonly blockedEitherWay: boolean;
  /** The target's share setting; undefined = never chosen, which does not share. */
  readonly targetShare: boolean | undefined;
  readonly targetOverride: PresenceOverride;
  /** The viewer's own share setting (reciprocity). */
  readonly viewerShare: boolean | undefined;
}

export const canSeePresence = (facts: PresenceVisibilityFacts): boolean =>
  facts.viewerId !== facts.targetId &&
  !facts.blockedEitherWay &&
  facts.mutual &&
  facts.targetShare === true &&
  facts.targetOverride !== "invisible" &&
  facts.viewerShare === true;

export interface PresenceRooms {
  readonly override: PresenceOverride;
  /** Any of the member's sessions is in the app:online room. */
  readonly inOnlineRoom: boolean;
  /** Any of the member's sessions is in the app:away room (visible but idle). */
  readonly inAwayRoom: boolean;
}

export const effectiveStatus = (rooms: PresenceRooms): PresenceStatus => {
  if (rooms.override === "invisible") return "offline";
  if (!rooms.inOnlineRoom && !rooms.inAwayRoom) return "offline";
  if (rooms.override === "away") return "away";
  return rooms.inOnlineRoom ? "online" : "away";
};

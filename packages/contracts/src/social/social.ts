import type { ConvexSystemFields } from "../shared/convex";

/**
 * A member's public profile (display name + bio). Faithful superset of the `profiles` row plus
 * the member it belongs to. `displayName`/`bio` come from the Social aggregate; `aggregateId` is
 * the ProfileId. A member with no profile yet is represented by a null read, not this shape.
 */
export interface ProfileView extends ConvexSystemFields {
  aggregateId?: string;
  memberId: string;
  displayName: string;
  bio?: string;
  /**
   * Who can see this profile. "public" reveals the member's identity to anyone; "private" hides
   * it from members they are not connected with. Absent on legacy rows, derived as "public".
   */
  visibility: "public" | "private";
  updatedAt: number;
}

/**
 * One party of a follow relationship as surfaced in a followers/following list: the other member's
 * id, their display name (from their profile, falling back to their account name), and when the
 * edge formed. `followId` is the Follow aggregateId so the UI can act on the specific edge.
 */
export interface FollowEdgeView {
  followId?: string;
  memberId: string;
  displayName: string;
  createdAt: number;
}

/**
 * One entry in a member's activity feed, mapped at the backend seam from foreign domain events
 * (CompletionRecorded / CopyAcquired / ExchangeCompleted) into Social's anti-corruption shape.
 * `ref` is an opaque pointer back to the originating record for the UI to deep-link.
 */
export interface ActivityEntryView {
  memberId: string;
  kind: "completion" | "acquisition" | "exchange";
  occurredAt: number;
  ref: string;
}

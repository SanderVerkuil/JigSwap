import type { ConvexSystemFields } from "../shared/convex";

/**
 * One row of the admin users directory (`admin.listUsers`). Admin-only read model: unlike
 * `MemberView` it deliberately includes `email` — the admin console is the one member-facing
 * surface allowed to see it (the query is gated server-side by requireMember + isAdmin).
 *
 * `role` mirrors the Clerk publicMetadata.role claim (users.role) and is DISPLAY-ONLY:
 * authorization stays JWT-based (identity/isAdmin) and must never read this field.
 */
export interface AdminUserView extends ConvexSystemFields {
  name: string;
  username?: string;
  email: string;
  avatar?: string;
  isActive: boolean;
  role?: string;
  /** Size of the member's library (ownedPuzzles via by_owner). */
  ownedCopyCount: number;
  createdAt: number;
}

/**
 * One entry of a member's moderation/audit trail on the admin user detail page
 * (`admin.getUserDetail`) — the same shape the moderation Activity Log renders.
 * `kind` stays a plain string so the DTO tolerates future audit kinds.
 */
export interface AdminAuditEntryView {
  kind: string;
  /** Acting admin's display name; null = automated pipeline (no actorId). */
  actorName: string | null;
  targetLabel: string;
  targetId: string;
  at: number;
}

/** One of the member's catalog submissions (`puzzles.by_submitted_by`). */
export interface AdminUserSubmissionView {
  _id: string;
  title: string;
  /**
   * "pending" | "approved" | "rejected" today; typed as a plain string so
   * future statuses (e.g. "disabled" from the definition-disable feature)
   * don't break the DTO.
   */
  status: string;
  createdAt: number;
}

/**
 * The admin user detail read model (`admin.getUserDetail`). Admin-only by
 * design: includes `email` and `clerkId`. `profile.role` mirrors the Clerk
 * publicMetadata.role claim and is DISPLAY-ONLY — authorization stays
 * JWT-based (identity/isAdmin) and must never read it.
 */
export interface AdminUserDetailView {
  profile: {
    _id: string;
    clerkId: string;
    name: string;
    username?: string;
    email: string;
    avatar?: string;
    bio?: string;
    location?: string;
    preferredLanguage?: string;
    isActive: boolean;
    role?: string;
    createdAt: number;
    updatedAt: number;
  };
  stats: {
    /** `ownedPuzzles.by_owner`, with the availability breakdown. */
    copies: {
      total: number;
      forTrade: number;
      forSale: number;
      forLend: number;
    };
    /** `collections.by_user`. */
    collections: number;
    /** `completions.by_user` (indexed — no table scan). */
    completions: number;
  };
  /** Newest first, capped at 50. */
  submissions: AdminUserSubmissionView[];
  /** Both lists newest first, capped at 20 each. */
  audit: {
    /** Actions this member performed as admin (`moderationActions.by_actor`). */
    performed: AdminAuditEntryView[];
    /** Actions targeting this member (`by_target`; targetId = clerkId for role rows). */
    received: AdminAuditEntryView[];
  };
}

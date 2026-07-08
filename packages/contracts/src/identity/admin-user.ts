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

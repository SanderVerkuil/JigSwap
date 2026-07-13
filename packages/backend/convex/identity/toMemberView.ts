import type { CurrentMemberView, MemberView } from "@jigswap/contracts";
import type { Doc } from "../_generated/dataModel";

// Shared row->DTO mapping for the member reads. Emits a PII-free MemberView (no email, no clerkId)
// so member-to-other projections never leak a member's email or Clerk subject id.
export const toMemberView = (user: Doc<"users">): MemberView => ({
  _id: user._id,
  _creationTime: user._creationTime,
  name: user.name,
  username: user.username,
  avatar: user.avatar,
  bio: user.bio,
  location: user.location,
  preferredLanguage: user.preferredLanguage,
  isActive: user.isActive,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

// Self-only projection: the signed-in member's own view, with email + clerkId re-added. Only the
// `getCurrentUser` ("me") query may use this — never a member-to-other read.
export const toCurrentMemberView = (user: Doc<"users">): CurrentMemberView => ({
  ...toMemberView(user),
  clerkId: user.clerkId,
  email: user.email,
  slug: user.slug,
});

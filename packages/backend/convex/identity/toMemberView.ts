import type {
  CurrentMemberView,
  MemberIdentityView,
  MemberView,
} from "@jigswap/contracts";
import type { Doc } from "../_generated/dataModel";

// A member's identity only (name, username, avatar), never bio, location or preferredLanguage: for
// surfaces that name a member whatever their profile visibility, so those details stay behind it.
export const toMemberIdentityView = (
  user: Doc<"users">,
): MemberIdentityView => ({
  _id: user._id,
  _creationTime: user._creationTime,
  name: user.name,
  username: user.username,
  avatar: user.avatar,
  isActive: user.isActive,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

// Shared row->DTO mapping for the member reads. Emits a PII-free MemberView (no email, no clerkId)
// so member-to-other projections never leak a member's email or Clerk subject id. It adds bio,
// location and preferredLanguage, so it may only reach a viewer the privacy rules reveal the member
// to (social/privacy projectMemberIdentity).
export const toMemberView = (user: Doc<"users">): MemberView => ({
  ...toMemberIdentityView(user),
  bio: user.bio,
  location: user.location,
  preferredLanguage: user.preferredLanguage,
});

// Self-only projection: the signed-in member's own view, with email + clerkId re-added. Only the
// `getCurrentUser` ("me") query may use this — never a member-to-other read. `handle` is the
// member's canonical handle (identity/canonicalHandleOf), which needs a read the mapper can't do.
export const toCurrentMemberView = (
  user: Doc<"users">,
  handle: string,
): CurrentMemberView => ({
  ...toMemberView(user),
  clerkId: user.clerkId,
  email: user.email,
  slug: user.slug,
  handle,
});

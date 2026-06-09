import type { MemberView } from "@jigswap/contracts";
import type { Doc } from "../_generated/dataModel";

// Shared row->DTO mapping for the member reads, so every identity adapter emits an identical
// MemberView superset of the `users` document instead of leaking the raw row.
export const toMemberView = (user: Doc<"users">): MemberView => ({
  _id: user._id,
  _creationTime: user._creationTime,
  clerkId: user.clerkId,
  email: user.email,
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

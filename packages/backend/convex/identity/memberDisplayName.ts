import { resolveMemberDisplayName } from "@jigswap/contracts";
import type { Doc } from "../_generated/dataModel";

// Backend adapters over the shared resolver (@jigswap/contracts resolveMemberDisplayName) for the
// read models that ship an already-resolved name string. `undefined` means "no identifiable name":
// the DTO field is left absent and the web renders its localized generic label.

/**
 * A member's display name as shown to OTHER members: the member-chosen profile display name, else
 * the account name, else the username. NEVER falls back to the email — other members must not see
 * it (see projectMemberIdentity / toMemberView).
 */
export const memberDisplayNameOf = (
  user: Pick<Doc<"users">, "name" | "username"> | null | undefined,
  profile?: Pick<Doc<"profiles">, "displayName"> | null,
): string | undefined =>
  resolveMemberDisplayName({ name: profile?.displayName })?.text ??
  (user
    ? resolveMemberDisplayName({ name: user.name, username: user.username })
        ?.text
    : undefined);

/**
 * A member's label on ADMIN-ONLY surfaces (moderation audit trail, admin tables), where the email
 * is visible by design: account name, else email, else username, else (a member with none of
 * those, e.g. no verified email yet) the Clerk id, so this always yields a label.
 */
export const adminMemberLabelOf = (
  user: Pick<Doc<"users">, "name" | "username" | "email" | "clerkId">,
): string =>
  resolveMemberDisplayName({
    name: user.name,
    email: user.email,
    username: user.username,
  })?.text ?? user.clerkId;

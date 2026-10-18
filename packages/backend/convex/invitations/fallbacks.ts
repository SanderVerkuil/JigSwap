import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// The in-app fallbacks for an email invitation whose address already belongs to a member (spec
// E1/E2): a connection offer (follow) or a household invite (household). SEAMS ONLY in E0a:
// both are no-ops until E0b fills them in.

export type EmailInviteFallback = NonNullable<Doc<"emailInvites">["fallback"]>;

/**
 * The existing-member path of sendEmailInvite: make the kind's normal in-app invite instead of an
 * email, gated as usual. Returns the ids of what it made (stored on the row so a revoke can
 * withdraw it), or undefined when nothing was made. Never tells the inviter either way.
 */
export const applyExistingMemberFallback = async (
  _ctx: MutationCtx,
  _args: {
    kind: Doc<"emailInvites">["kind"];
    inviterId: Id<"users">;
    householdId?: string;
    memberId: Id<"users">;
    ref: string;
  },
): Promise<EmailInviteFallback | undefined> => undefined;

/** Withdraw the row's still-pending in-app fallback (revoke, account deletion). */
export const withdrawFallback = async (
  _ctx: MutationCtx,
  _row: Doc<"emailInvites">,
): Promise<void> => {};

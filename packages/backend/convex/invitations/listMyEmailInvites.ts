import type { EmailInviteView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { emailInviteKindValidator } from "./config";

// Read side: the acting member's own pending email invitations of one kind, newest first. A row
// carries no address and nothing about who it reached, so the list looks the same whether or not
// the address had an account. Lapsed rows (past expiresAt, expiry not yet run) are left out.
export const listMyEmailInvites = query({
  args: { kind: emailInviteKindValidator },
  handler: async (ctx, { kind }): Promise<EmailInviteView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const now = Date.now();
    const rows = await ctx.db
      .query("emailInvites")
      .withIndex("by_inviter", (q) => q.eq("inviterId", me).eq("kind", kind))
      .order("desc")
      .collect();
    return rows
      .filter((row) => row.expiresAt > now)
      .map((row) => ({
        inviteRef: row.aggregateId,
        kind: row.kind,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      }));
  },
});

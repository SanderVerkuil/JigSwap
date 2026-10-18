import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Whether the member chose "Appear offline": then they emit no typing indicator (spec Q13), and
 * conversation/setTyping is a silent no-op for them.
 *
 * TODO(G8): read `presencePreferences.override === "invisible"` for the member once the presence
 * settings table exists. Until then nobody can appear offline.
 *
 * TODO(G8): this only stops NEW typing. A member who switches to "Appear offline" mid-typing
 * leaves a live typing row for up to TYPING_TTL_MS: the override change must also delete the
 * member's typingIndicators rows (by_member), or getTyping must drop typers who appear offline.
 */
export const isAppearingOffline = async (
  _ctx: QueryCtx,
  _memberId: Id<"users">,
): Promise<boolean> => false;

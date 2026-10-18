import type { PresenceSettingsView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { findPresencePreferences } from "./presencePreferences";

// The acting member's own presence settings. share null = never chosen (one-time prompt).
export const getMyPresenceSettings = query({
  args: {},
  handler: async (ctx): Promise<PresenceSettingsView> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;
    const row = await findPresencePreferences(ctx, memberId);
    return { share: row?.share ?? null, override: row?.override ?? "auto" };
  },
});

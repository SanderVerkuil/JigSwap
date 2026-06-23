import type { MemberId } from "@jigswap/domain";
import type { QueryCtx } from "../_generated/server";

// A bounded context contributes a named slice of a member's settings to the federated read. Each
// context owns its settings domain; this is only the read-composition seam (infrastructure).
export interface MemberSettingsSection {
  readonly section: string;
  read(ctx: QueryCtx, memberId: MemberId): Promise<Record<string, unknown>>;
}

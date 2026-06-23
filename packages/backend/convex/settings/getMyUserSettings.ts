import { toMemberId } from "@jigswap/domain";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { memberSettingsSections } from "./providers";

// Member-gated composition root: builds the member's full settings object by reading every
// registered context section. Shape: { [section]: { ...sectionValues } }. Read-only.
export const getMyUserSettings = query({
  args: {},
  handler: async (ctx) => {
    const memberId = toMemberId(
      (await requireMember(ctx)) as unknown as string,
    );
    const sections = await Promise.all(
      memberSettingsSections.map(async (provider) => [
        provider.section,
        await provider.read(ctx, memberId),
      ]),
    );
    return Object.fromEntries(sections) as {
      solving: { trackCompletionDuration?: boolean };
    };
  },
});

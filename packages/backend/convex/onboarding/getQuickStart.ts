import type { QuickStartView } from "@jigswap/contracts";
import { deriveQuickStart } from "@jigswap/domain";
import { query } from "../_generated/server";
import { requireMemberUser } from "../whatsNew/readState";
import { onboardingRowOf, quickStartStateOf } from "./memberOnboarding";
import { quickStartFactsOf } from "./quickStartFacts";

// The acting member's quick start: eligibility, welcome/card visibility and each step's status.
// "Done" is derived from the member's own rows (pure rule: deriveQuickStart); only skipped steps
// and dismissals come from memberOnboarding. Reads only the caller's own data.
export const getQuickStart = query({
  args: {},
  handler: async (ctx): Promise<QuickStartView> => {
    const member = await requireMemberUser(ctx);
    const [row, facts] = await Promise.all([
      onboardingRowOf(ctx, member._id),
      quickStartFactsOf(ctx, member),
    ]);
    return deriveQuickStart({
      now: Date.now(),
      accountCreatedAt: member.createdAt,
      state: quickStartStateOf(row),
      facts,
    });
  },
});

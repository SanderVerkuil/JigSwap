import {
  deriveQuickStart,
  isValidActivationRange,
  summarizeActivation,
  type ActivationFacts,
  type ActivationReport,
  type ActivationReportMember,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { onboardingRowOf, quickStartStateOf } from "./memberOnboarding";
import { quickStartFactsOf } from "./quickStartFacts";

// Rows read per member and fact. Index order is creation order, so the earliest rows (the ones
// that can fall inside a 7-day window) come first; a member needs only 3 copies and 1 of the rest.
const READ_CAP = 51;

// The activation report (spec 2026-10-17 §1.2, decisions 5 and 10). INTERNAL ONLY: it is never in
// the gateway and no client can call it. An operator runs it against a sign-up range of at most 31
// days; it returns aggregates only (no member ids) per weekly sign-up cohort and in total.
//
// Activated = within 7 days of sign-up (users.createdAt, inclusive): ≥ 3 own copies AND (≥ 1
// finished solve at any date precision OR ≥ 1 mutual connection OR a household link). Household
// link (decision 10): the member created or joined a household inside their window AND that
// household has ≥ 1 other member, whenever that member joined. Activation can therefore flip to
// true after day 7, when a second member joins later, so re-running the report for a closed cohort
// can raise its count. Copies or solves deleted since are gone and do not count.
//
// Run it (documentation only; never against a shared deployment from an agent session):
//   npx convex run --prod onboarding/activationReport:activationReport \
//     '{"from": 1788220800000, "to": 1790812800000}'
// `from`/`to` are epoch ms of sign-up time, [from, to): here September 2026 (UTC), 30 days.
export const activationReport = internalQuery({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }): Promise<ActivationReport> => {
    if (!isValidActivationRange(from, to)) {
      throw new ConvexError({ code: "invalid_range" });
    }
    const now = Date.now();
    const users = await ctx.db
      .query("users")
      .withIndex("by_creation_time", (q) =>
        q.gte("_creationTime", from).lt("_creationTime", to),
      )
      .collect();
    const members = await Promise.all(
      users.map((user) => reportMemberOf(ctx, user, now)),
    );
    return summarizeActivation(members, { from, to, now });
  },
});

const reportMemberOf = async (
  ctx: QueryCtx,
  user: Doc<"users">,
  now: number,
): Promise<ActivationReportMember> => {
  const [activation, row, facts, householdLink] = await Promise.all([
    activationFactsOf(ctx, user),
    onboardingRowOf(ctx, user._id),
    quickStartFactsOf(ctx, user),
    ctx.db
      .query("inviteLinks")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .filter((q) => q.neq(q.field("context"), undefined))
      .first(),
  ]);
  const quickStart = deriveQuickStart({
    now,
    accountCreatedAt: user.createdAt,
    state: quickStartStateOf(row),
    facts,
  });
  return {
    signupAt: user.createdAt,
    activation,
    welcomeAnswered: row?.welcomeDismissedAt !== undefined,
    startedQuickStart: row?.startedAt !== undefined,
    householdLinkCreated: householdLink !== null,
    steps: quickStart.steps,
  };
};

const activationFactsOf = async (
  ctx: QueryCtx,
  user: Doc<"users">,
): Promise<ActivationFacts> => {
  const me = user._id;
  const [copies, completions, follows, membership] = await Promise.all([
    ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", me))
      .take(READ_CAP),
    ctx.db
      .query("completions")
      .withIndex("by_user_completed", (q) =>
        q.eq("userId", me).eq("isCompleted", true),
      )
      .take(READ_CAP),
    ctx.db
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerId", me))
      .take(READ_CAP),
    ctx.db
      .query("householdMembers")
      .withIndex("by_member", (q) => q.eq("memberId", me))
      .first(),
  ]);
  // A connection is mutual when the followee follows back; it counts from the later row.
  const mutualConnectedAts = (
    await Promise.all(
      follows.map(async (out) => {
        const back = await ctx.db
          .query("follows")
          .withIndex("by_follower_followee", (q) =>
            q.eq("followerId", out.followeeId).eq("followeeId", me),
          )
          .first();
        return back ? Math.max(out.createdAt, back.createdAt) : null;
      }),
    )
  ).filter((at): at is number => at !== null);
  // Decision 10: any other member counts, whenever they joined.
  const household = membership
    ? {
        joinedAt: membership.joinedAt,
        hasOtherMember: (
          await ctx.db
            .query("householdMembers")
            .withIndex("by_household", (q) =>
              q.eq("householdId", membership.householdId),
            )
            .take(2)
        ).some((m) => m.memberId !== me),
      }
    : undefined;
  return {
    copyCreatedAts: copies.map((c) => c.createdAt),
    completionCreatedAts: completions.map((c) => c.createdAt),
    mutualConnectedAts,
    ...(household ? { household } : {}),
  };
};

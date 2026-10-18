import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import { RATE_LIMITS, type RateLimitName } from "../lib/rateLimits";
import { removeForDeletedMember } from "./messageAttachments";

// Account deletion for messaging data (spec R.9, 2.8), scheduled by users.deleteUser. Text
// messages stay: their author renders as "deleted member" (social/privacy projectMemberIdentity).
// Everything else the member left behind in messaging, blocking and reporting goes:
//   attachments  their photos and locations (conversation/messageAttachments removeForDeletedMember)
//   reveals      their own taps on "Show"
//   gpsViews     their recent current-location picker views (self-expiring after 15 minutes)
//   blocksOut    the blocks they placed
//   blocksIn     the blocks placed on them
//   reports      the reports they FILED are anonymised (reports ABOUT them are kept until their
//                retention purge, reports/retention)
//   invitesOut   the circle invites they sent    } deleted whatever their status, with the
//   invitesIn    the circle invites they received } notifications pointing at them, so the other
//   offersOut    the connection offers they made  } party has nothing left to open (like
//   offersIn     the connection offers made them  } purgeDeletedCircle, nothing is announced)
//   rateLimits   their own counters (never the deployment-wide MapTiler budget keys)
// One phase at a time, PURGE_BATCH_SIZE rows per run: a run that did not finish its phase
// schedules the next run with the page cursor, so each run stays well inside Convex's per-mutation
// limits whatever the member's history. Rows a phase keeps (a quarantined or evidence-held photo)
// stay in the index; the cursor walks past them.

/** Rows handled per run. */
export const PURGE_BATCH_SIZE = 100;

const PHASES = [
  "attachments",
  "reveals",
  "gpsViews",
  "blocksOut",
  "blocksIn",
  "reports",
  "invitesOut",
  "invitesIn",
  "offersOut",
  "offersIn",
  "rateLimits",
] as const;
type Phase = (typeof PHASES)[number];

const phaseValidator = v.union(
  v.literal("attachments"),
  v.literal("reveals"),
  v.literal("gpsViews"),
  v.literal("blocksOut"),
  v.literal("blocksIn"),
  v.literal("reports"),
  v.literal("invitesOut"),
  v.literal("invitesIn"),
  v.literal("offersOut"),
  v.literal("offersIn"),
  v.literal("rateLimits"),
);

type Page = { isDone: boolean; continueCursor: string };

// Delete the recipient's notifications of `type` whose subject is `subjectId`. A member holds few
// of one invite type, so the by_user_type read stays small.
const deleteNotificationsAbout = async (
  ctx: MutationCtx,
  recipientId: Id<"users">,
  type: "circle_invite_received" | "connection_offer_received",
  subjectId: string,
): Promise<void> => {
  const rows = await ctx.db
    .query("notifications")
    .withIndex("by_user_type", (q) =>
      q.eq("userId", recipientId).eq("type", type),
    )
    .collect();
  for (const row of rows) {
    const subject = row.subject;
    const id =
      subject?.kind === "circleInvite"
        ? subject.inviteId
        : subject?.kind === "connectionOffer"
          ? subject.offerId
          : undefined;
    if (id === subjectId) await ctx.db.delete(row._id);
  }
};

const deleteInvite = async (ctx: MutationCtx, row: Doc<"circleInvites">) => {
  await deleteNotificationsAbout(
    ctx,
    row.inviteeId,
    "circle_invite_received",
    row.aggregateId,
  );
  await ctx.db.delete(row._id);
};

const deleteOffer = async (ctx: MutationCtx, row: Doc<"connectionOffers">) => {
  await deleteNotificationsAbout(
    ctx,
    row.toId,
    "connection_offer_received",
    row.aggregateId,
  );
  await ctx.db.delete(row._id);
};

const runPhase = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
  phase: Phase,
  opts: { cursor: string | null; numItems: number },
): Promise<Page> => {
  switch (phase) {
    case "attachments": {
      const page = await ctx.db
        .query("messageAttachments")
        .withIndex("by_uploader", (q) => q.eq("uploaderId", memberId))
        .paginate(opts);
      for (const row of page.page) await removeForDeletedMember(ctx, row);
      return page;
    }
    case "reveals": {
      const page = await ctx.db
        .query("messageImageReveals")
        .withIndex("by_viewer", (q) => q.eq("viewerId", memberId))
        .paginate(opts);
      for (const row of page.page) await ctx.db.delete(row._id);
      return page;
    }
    case "gpsViews": {
      const page = await ctx.db
        .query("locationGpsViews")
        .withIndex("by_member_thread", (q) => q.eq("memberId", memberId))
        .paginate(opts);
      for (const row of page.page) await ctx.db.delete(row._id);
      return page;
    }
    case "blocksOut": {
      const page = await ctx.db
        .query("blocks")
        .withIndex("by_blocker", (q) => q.eq("blockerId", memberId))
        .paginate(opts);
      for (const row of page.page) await ctx.db.delete(row._id);
      return page;
    }
    case "blocksIn": {
      const page = await ctx.db
        .query("blocks")
        .withIndex("by_blocked", (q) => q.eq("blockedId", memberId))
        .paginate(opts);
      for (const row of page.page) await ctx.db.delete(row._id);
      return page;
    }
    case "reports": {
      const page = await ctx.db
        .query("reports")
        .withIndex("by_reporter_created", (q) => q.eq("reporterId", memberId))
        .paginate(opts);
      const now = Date.now();
      for (const report of page.page) {
        // The notice's goodFaith attestation stays; the notifier's name and email go.
        await ctx.db.patch(report._id, {
          reporterId: undefined,
          reporterAnonymisedAt: now,
          ...(report.illegalNotice && {
            illegalNotice: { goodFaith: report.illegalNotice.goodFaith },
          }),
        });
      }
      return page;
    }
    case "invitesOut": {
      const page = await ctx.db
        .query("circleInvites")
        .withIndex("by_inviter", (q) => q.eq("inviterId", memberId))
        .paginate(opts);
      for (const row of page.page) await deleteInvite(ctx, row);
      return page;
    }
    case "invitesIn": {
      const page = await ctx.db
        .query("circleInvites")
        .withIndex("by_invitee_status", (q) => q.eq("inviteeId", memberId))
        .paginate(opts);
      for (const row of page.page) await deleteInvite(ctx, row);
      return page;
    }
    case "offersOut": {
      const page = await ctx.db
        .query("connectionOffers")
        .withIndex("by_from_to_status", (q) => q.eq("fromId", memberId))
        .paginate(opts);
      for (const row of page.page) await deleteOffer(ctx, row);
      return page;
    }
    case "offersIn": {
      const page = await ctx.db
        .query("connectionOffers")
        .withIndex("by_to_status", (q) => q.eq("toId", memberId))
        .paginate(opts);
      for (const row of page.page) await deleteOffer(ctx, row);
      return page;
    }
    case "rateLimits": {
      // One row per limit name at most: a fixed handful of point lookups, never paged.
      for (const name of Object.keys(RATE_LIMITS) as RateLimitName[]) {
        const row = await ctx.db
          .query("rateLimits")
          .withIndex("by_key", (q) => q.eq("key", `${name}:${memberId}`))
          .unique();
        if (row) await ctx.db.delete(row._id);
      }
      return { isDone: true, continueCursor: "" };
    }
  }
};

export const purgeMemberMessagingData = internalMutation({
  args: {
    memberId: v.id("users"),
    phase: v.optional(phaseValidator),
    cursor: v.optional(v.string()),
    // Tests only: a smaller batch, to exercise the chunking.
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, { memberId, phase, cursor, batchSize }) => {
    const current = phase ?? PHASES[0];
    const numItems = batchSize ?? PURGE_BATCH_SIZE;
    const page = await runPhase(ctx, memberId, current, {
      cursor: cursor ?? null,
      numItems,
    });
    const next = page.isDone ? PHASES[PHASES.indexOf(current) + 1] : current;
    if (next === undefined) {
      logEvent({
        event: "users.purgeMemberMessagingData",
        outcome: "success",
        member_id: memberId,
      });
      return;
    }
    await ctx.scheduler.runAfter(
      0,
      internal.conversation.purgeMemberMessagingData.purgeMemberMessagingData,
      {
        memberId,
        phase: next,
        ...(!page.isDone && { cursor: page.continueCursor }),
        ...(batchSize !== undefined && { batchSize }),
      },
    );
  },
});

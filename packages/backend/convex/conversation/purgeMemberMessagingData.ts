import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  deleteNotificationsAbout as deleteInviteNotificationsAbout,
  withdrawFallback,
} from "../invitations/fallbacks";
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
//   householdInvitesOut  the household invites they sent     } deleted whatever their status, with
//   householdInvitesIn   the household invites they received } the invitee's notification about it
//   followsOut   their edges to the people they follow } deleted whatever their status, with
//   followsIn    the edges of the people following them } the follow notifications naming them
//   requestsOut  the follow requests they sent          } in the other party's inbox (a grouped
//   requestsIn   the follow requests sent to them       } new_follower row only loses them)
//                Follower counts and "followers you know" are read live from `follows`.
//   staleNewFollower      } follow notifications naming them that no edge or request leads to any
//   staleRequestReceived  } more (they unfollowed, or cancelled a request): every row of the type
//   staleRequestApproved  } is scanned, since actorIds is an array and cannot be indexed
//   redemptionsOut  the redemptions of their invite links } deleted; the counters on the links
//   redemptionsIn   their own redemption of someone's link } stay (historic totals, no identity)
//   inviteLinks     their invite links, so none can still be redeemed
//   pushSubscriptions, favorites, tourProgress, settings  their own per-member rows
//   notifications   their own inbox (resolveForDelivery drops an email or push still due)
//   emailInvitesOut  the email invitations they sent: each row is deleted, its pending in-app
//                fallback withdrawn and its Clerk invitation revoked (best-effort, scheduled).
//                The address-HMAC send log holds no member id and lapses on its own.
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
  "householdInvitesOut",
  "householdInvitesIn",
  "followsOut",
  "followsIn",
  "requestsOut",
  "requestsIn",
  "staleNewFollower",
  "staleRequestReceived",
  "staleRequestApproved",
  "redemptionsOut",
  "redemptionsIn",
  "inviteLinks",
  "pushSubscriptions",
  "favorites",
  "tourProgress",
  "settings",
  "notifications",
  "emailInvitesOut",
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
  v.literal("householdInvitesOut"),
  v.literal("householdInvitesIn"),
  v.literal("followsOut"),
  v.literal("followsIn"),
  v.literal("requestsOut"),
  v.literal("requestsIn"),
  v.literal("staleNewFollower"),
  v.literal("staleRequestReceived"),
  v.literal("staleRequestApproved"),
  v.literal("redemptionsOut"),
  v.literal("redemptionsIn"),
  v.literal("inviteLinks"),
  v.literal("pushSubscriptions"),
  v.literal("favorites"),
  v.literal("tourProgress"),
  v.literal("settings"),
  v.literal("notifications"),
  v.literal("emailInvitesOut"),
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

type FollowNoticeType =
  "new_follower" | "follow_request_received" | "follow_request_approved";

// Take `actorId` out of one follow notification: a row naming only them is deleted; a grouped
// new_follower row drops them from its actors and, when they were its newest actor (whose name and
// id the row carries for legacy renderers), points at the next one instead. A grouped row stores
// at most MAX_GROUPED_ACTOR_IDS actors, so an actor past the cap is not on it at all: nothing
// names them, but its actorCount stays one too high ("and N others"). Left as is: no stored data
// says which actors fell past the cap.
const removeActorFromRow = async (
  ctx: MutationCtx,
  row: Doc<"notifications">,
  actorId: Id<"users">,
): Promise<void> => {
  const actorIds = row.actorIds ?? [];
  if (!actorIds.includes(actorId) && row.relatedId !== actorId) return;
  const rest = actorIds.filter((id) => id !== actorId);
  if (rest.length === 0) {
    await ctx.db.delete(row._id);
    return;
  }
  const { actorName: _name, ...params } = row.params ?? {};
  await ctx.db.patch(row._id, {
    actorIds: rest,
    actorCount: Math.max(row.actorCount ?? 0, actorIds.length) - 1,
    ...(row.relatedId === actorId && {
      relatedId: rest[0],
      params: Object.keys(params).length > 0 ? params : undefined,
    }),
  });
};

// Take `actorId` out of the recipient's notifications of one follow type.
const removeActorFromNotifications = async (
  ctx: MutationCtx,
  recipientId: Id<"users">,
  type: FollowNoticeType,
  actorId: Id<"users">,
): Promise<void> => {
  const rows = await ctx.db
    .query("notifications")
    .withIndex("by_user_type", (q) =>
      q.eq("userId", recipientId).eq("type", type),
    )
    .collect();
  for (const row of rows) await removeActorFromRow(ctx, row, actorId);
};

const STALE_FOLLOW_TYPE = {
  staleNewFollower: "new_follower",
  staleRequestReceived: "follow_request_received",
  staleRequestApproved: "follow_request_approved",
} as const satisfies Partial<Record<Phase, FollowNoticeType>>;

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
    case "householdInvitesOut":
    case "householdInvitesIn": {
      // Every household invite they sent or received, whatever its status, with the
      // household_invite_received notification about it in the invitee's inbox. Membership itself
      // is not touched here.
      const page = await (
        phase === "householdInvitesOut"
          ? ctx.db
              .query("householdInvites")
              .withIndex("by_inviter", (q) => q.eq("inviterId", memberId))
          : ctx.db
              .query("householdInvites")
              .withIndex("by_invitee_status", (q) =>
                q.eq("inviteeId", memberId),
              )
      ).paginate(opts);
      for (const row of page.page) {
        await deleteInviteNotificationsAbout(
          ctx,
          row.inviteeId,
          "household_invite_received",
          row.aggregateId,
        );
        await ctx.db.delete(row._id);
      }
      return page;
    }
    case "followsOut": {
      const page = await ctx.db
        .query("follows")
        .withIndex("by_follower", (q) => q.eq("followerId", memberId))
        .paginate(opts);
      for (const row of page.page) {
        await removeActorFromNotifications(
          ctx,
          row.followeeId,
          "new_follower",
          memberId,
        );
        await ctx.db.delete(row._id);
      }
      return page;
    }
    case "followsIn": {
      // Nothing in the follower's inbox comes from this edge: a follow_request_approved from the
      // member goes with its request (requestsIn).
      const page = await ctx.db
        .query("follows")
        .withIndex("by_followee", (q) => q.eq("followeeId", memberId))
        .paginate(opts);
      for (const row of page.page) await ctx.db.delete(row._id);
      return page;
    }
    case "requestsOut": {
      const page = await ctx.db
        .query("followRequests")
        .withIndex("by_requester", (q) => q.eq("requesterId", memberId))
        .paginate(opts);
      for (const row of page.page) {
        await removeActorFromNotifications(
          ctx,
          row.targetId,
          "follow_request_received",
          memberId,
        );
        await ctx.db.delete(row._id);
      }
      return page;
    }
    case "requestsIn": {
      const page = await ctx.db
        .query("followRequests")
        .withIndex("by_target", (q) => q.eq("targetId", memberId))
        .paginate(opts);
      for (const row of page.page) {
        await removeActorFromNotifications(
          ctx,
          row.requesterId,
          "follow_request_approved",
          memberId,
        );
        await ctx.db.delete(row._id);
      }
      return page;
    }
    case "staleNewFollower":
    case "staleRequestReceived":
    case "staleRequestApproved": {
      // Reads every row of the type, in pages (a deletion is rare; the scan is bounded per run).
      // If this grows too large, project actors into an indexed (actorId, notificationId) table.
      const type = STALE_FOLLOW_TYPE[phase];
      const page = await ctx.db
        .query("notifications")
        .withIndex("by_type", (q) => q.eq("type", type))
        .paginate(opts);
      for (const row of page.page) {
        if (row.userId !== memberId)
          await removeActorFromRow(ctx, row, memberId);
      }
      return page;
    }
    case "redemptionsOut": {
      const page = await ctx.db
        .query("inviteRedemptions")
        .withIndex("by_inviter", (q) => q.eq("inviterId", memberId))
        .paginate(opts);
      for (const row of page.page) await ctx.db.delete(row._id);
      return page;
    }
    case "redemptionsIn": {
      // A household link they used keeps consumedAt (it stays used up) but no longer names them.
      const page = await ctx.db
        .query("inviteRedemptions")
        .withIndex("by_new_member", (q) => q.eq("newMemberId", memberId))
        .paginate(opts);
      for (const row of page.page) {
        const link = await ctx.db.get(row.inviteLinkId);
        if (link?.consumedBy === memberId) {
          await ctx.db.patch(link._id, { consumedBy: undefined });
        }
        await ctx.db.delete(row._id);
      }
      return page;
    }
    case "inviteLinks": {
      const page = await ctx.db
        .query("inviteLinks")
        .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
        .paginate(opts);
      for (const row of page.page) await ctx.db.delete(row._id);
      return page;
    }
    case "pushSubscriptions": {
      const page = await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_user", (q) => q.eq("userId", memberId))
        .paginate(opts);
      for (const row of page.page) await ctx.db.delete(row._id);
      return page;
    }
    case "favorites": {
      const page = await ctx.db
        .query("favorites")
        .withIndex("by_user", (q) => q.eq("userId", memberId))
        .paginate(opts);
      for (const row of page.page) await ctx.db.delete(row._id);
      return page;
    }
    case "tourProgress": {
      const page = await ctx.db
        .query("whatsNewTourProgress")
        .withIndex("by_member_tour", (q) => q.eq("memberId", memberId))
        .paginate(opts);
      for (const row of page.page) await ctx.db.delete(row._id);
      return page;
    }
    case "settings": {
      // One row per member in each: a handful of reads, never paged.
      const rows = [
        ...(await ctx.db
          .query("notificationPreferences")
          .withIndex("by_member", (q) => q.eq("memberId", memberId))
          .collect()),
        ...(await ctx.db
          .query("solvingPreferences")
          .withIndex("by_member", (q) => q.eq("memberId", memberId))
          .collect()),
        ...(await ctx.db
          .query("profiles")
          .withIndex("by_member", (q) => q.eq("memberId", memberId))
          .collect()),
        ...(await ctx.db
          .query("whatsNewReadStates")
          .withIndex("by_member", (q) => q.eq("memberId", memberId))
          .collect()),
        ...(await ctx.db
          .query("memberOnboarding")
          .withIndex("by_member", (q) => q.eq("memberId", memberId))
          .collect()),
      ];
      for (const row of rows) await ctx.db.delete(row._id);
      return { isDone: true, continueCursor: "" };
    }
    case "notifications": {
      const page = await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", memberId))
        .paginate(opts);
      for (const row of page.page) await ctx.db.delete(row._id);
      return page;
    }
    case "emailInvitesOut": {
      const page = await ctx.db
        .query("emailInvites")
        .withIndex("by_inviter", (q) => q.eq("inviterId", memberId))
        .paginate(opts);
      for (const row of page.page) {
        await withdrawFallback(ctx, row);
        if (row.clerkInvitationId !== undefined) {
          await ctx.scheduler.runAfter(
            0,
            internal.invitations.revokeClerkInvitation.revokeClerkInvitation,
            { clerkInvitationId: row.clerkInvitationId, reason: "purged" },
          );
        }
        await ctx.db.delete(row._id);
      }
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

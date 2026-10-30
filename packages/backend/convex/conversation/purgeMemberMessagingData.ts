import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  deleteNotificationsAbout as deleteInviteNotificationsAbout,
  withdrawFallback,
} from "../invitations/fallbacks";
import { logEvent } from "../lib/logEvent";
import {
  inviteLandingBudget,
  RATE_LIMITS,
  type RateLimitName,
} from "../lib/rateLimits";
import { presence } from "../presence";
import { isCopiedLegacyMessage } from "./backfill";
import { removeForDeletedMember } from "./messageAttachments";
import { purgeThreadBatch } from "./purgeCircleThread";
import { scrubMemberEvents } from "./purgeMemberEvents";
import {
  cancelOpenExchanges,
  closeOpenLoans,
  deleteCollections,
  deleteOwnCopies,
  deleteOwnRows,
  deleteUploadedCopyPhotos,
  handOverOwnedCircles,
  leaveHousehold,
  purgeCompletions,
} from "./purgeMemberLibrary";
import { threadRowByAggregateId } from "./readModelHelpers";

// Account deletion for messaging data (spec R.9, 2.8), scheduled by users.deleteUser. Text
// messages stay: their author renders as "deleted member" (social/privacy projectMemberIdentity).
// Likewise their id stays in other members' message notifications (a thread's grouped row lists
// its authors in actorIds): it resolves as a departed actor, "Former member", never a name, so
// those rows are deliberately not rewritten (spec 5.4: past messages stay, shown as a former
// member).
// Everything else the member left behind in messaging, blocking and reporting goes:
//   attachments  their photos and locations (conversation/messageAttachments removeForDeletedMember)
//   reveals      their own taps on "Show"
//   gpsViews     their recent current-location picker views (self-expiring after 15 minutes)
//   circleParticipants  their seats in circle group threads: the participant row (read receipt,
//                unread, mute) goes and they leave the thread's participant set, so no later save
//                re-creates the row. Their circle messages stay, shown as "deleted member". No
//                "left" row is posted: their circle memberships are not removed by this purge.
//                Exchange/DM participant rows are kept: the pair thread stays readable for the
//                other party, and its participant set and pair key (one DM per pair) need both.
//                Once nobody in it has an account left, pairThreads purges it whole.
//   typing       their typing indicators, in every thread kind
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
//   householdJoinRequestsOut  the requests to join a household they sent: deleted whatever their
//                status, with the admin's notification about each
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
//   inviteLinks     their invite links, so none can still be redeemed, with each link's landing
//                   counter on rateLimits
//   pushSubscriptions, favorites, tourProgress, settings  their own per-member rows
//   notifications   their own inbox (resolveForDelivery drops an email or push still due)
//   emailInvitesOut  the email invitations they sent: each row is deleted, its pending in-app
//                fallback withdrawn and its Clerk invitation revoked (best-effort, scheduled).
//                The address-HMAC send log holds no member id and lapses on its own.
//   rateLimits   their own counters and every per-pair counter naming them on either side (never
//                the deployment-wide MapTiler budget keys)
//   presence     their presencePreferences row and the presence component's rows for every room
//                they were in (each keeps a lastDisconnected: a last-seen record, spec 5.6)
// Then the rest of what they left (conversation/purgeMemberLibrary; spec 2026-10-19 deleted member
// ghost). Open trades and loans settle before their copies go, copies before photos. Nothing here
// ever touches a copy someone else owns now: their History rows (transfers, loans, completions)
// stay and name the member as a departed "Deleted member".
//   exchangesOpen    the proposed/accepted exchanges they started } cancelled; completed, rejected,
//   exchangesOpenIn  the proposed/accepted exchanges sent to them } cancelled and disputed stay.
//                The other party, if still active, gets a trade_cancelled_member_deleted
//                notification (actor: the departed member, "Deleted member") and a system row in
//                the exchange's thread.
//   legacyMessagesSent      } their rows in the legacy exchange chat (`messages`, from before
//   legacyMessagesReceived  } Conversation), both directions: a row conversation/backfill has
//                copied into its exchange thread is a duplicate and is deleted (the thread keeps the
//                message, like any other); one never copied is the only copy and is kept, counted
//                in the log (conversation.purgeLegacyMessages kept_unmigrated).
//   pairThreads  their DM and exchange threads: one none of whose participants has a users row
//                left (they were the last) is purged whole by purgeOrphanThread, in its own
//                batches (conversation/purgeCircleThread purgeThreadBatch: messages, attachments,
//                typing, participant rows, then the thread). An attachment an open report holds or
//                a quarantined photo stays, detached. A tombstoned participant (open CSAM
//                escalation) still has a users row, so their threads stay. Runs after the legacy
//                phases, which need the thread's copies to tell a copied legacy row.
//   loansOpen    the open loans of copies they lent  } returned (closedAt now), the copy back with
//   loansOpenIn  the open loans of copies they borrow } its owner; loan rows stay as history
//   copies       the copies they own now (by_owner only), each with its collection memberships,
//                copy reviews, circle shares, copy-scoped comments, photos (blobs included) and
//                their own completions on it. Exchanges, loans and custody entries naming it stay.
//   copyPhotos   their photos on copies other members own: row, blob and the photo's comments
//   completions  their remaining completions: one on a copy someone else owns stays (that copy's
//                History) without its photos and their private notes; any other goes, photos and
//                blobs included
//                Photos keep the attachments' rule: a quarantined one (CSAM hash match) stays whole
//                and a blob a CSAM escalation preserves is never deleted.
//   goals, collections (with their memberships, wishlists included), categories (personal)
//   circlesOwned  each circle they own goes to its longest-standing active Admin, else its
//                longest-standing active member (users row present and active); their seat stays
//                as a departed seat. With nobody active left it is deleted (purgeDeletedCircle).
//                Their seats in other members' circles stay too, as departed seats.
//   household    they leave it through the leave use case: an admin's household promotes its
//                longest-standing member, a sole member's is dissolved. Co-members already
//                deleted leave first, so the promotion only lands on an active member.
//   domainEvents (last; conversation/purgeMemberEvents) every finished event whose payload names
//                them: their own activity-feed events (solves started and recorded, copies
//                acquired) are deleted; in every other one their id becomes "deleted-member" and
//                copied personal fields (email, clerkId, names, avatar, bio, location, notes,
//                collection/category names) are dropped. Their event lookup rows
//                (domainEventMembers) go with it. Once the lookup backfill has run
//                (events/eventMembers) the phase reads only their events, by index,
//                EVENT_INDEX_BATCH_SIZE per run. Before that it pages the whole log,
//                EVENT_SCRUB_BATCH_SIZE events per run, and an event keyed by a copy alone
//                (CopyDetailsUpdated with the owner's notes, recorded before
//                events/recordAndSchedule left notes out) loses those personal fields once its
//                copy is gone, theirs (deleted by the copies phase) or anyone's.
//                Starts EVENT_SCRUB_DELAY_MS after the household phase, once the events the
//                purge itself emitted have been dispatched.
//                Admin, CSAM and moderation records are separate tables and stay unchanged.
//                A moderation audit row names a member by users id only (targetMemberId,
//                SEC-57), so it needs no scrub: it reads "Deleted member" once the row is gone.
// One phase at a time, PURGE_BATCH_SIZE rows per run: a run that did not finish its phase
// schedules the next run with the page cursor, so each run stays well inside Convex's per-mutation
// limits whatever the member's history. Rows a phase keeps (a quarantined or evidence-held photo)
// stay in the index; the cursor walks past them.

/** Rows handled per run. */
export const PURGE_BATCH_SIZE = 100;
// The domainEvents phase, before the event lookup backfill has run, reads the whole log and writes
// only the events that name the member (conversation/purgeMemberEvents).
export const EVENT_SCRUB_BATCH_SIZE = 1000;
// It starts this long after the phase before it, so events the earlier phases emitted (leaving the
// household, deleting a circle) have finished dispatching, retries included (events/dispatch: 1 +
// 2 + 4 + 8 minutes), and are not skipped as in flight.
export const EVENT_SCRUB_DELAY_MS = 20 * 60_000;

const PHASES = [
  "attachments",
  "reveals",
  "gpsViews",
  "circleParticipants",
  "typing",
  "blocksOut",
  "blocksIn",
  "reports",
  "invitesOut",
  "invitesIn",
  "offersOut",
  "offersIn",
  "householdInvitesOut",
  "householdInvitesIn",
  "householdJoinRequestsOut",
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
  "presence",
  "exchangesOpen",
  "exchangesOpenIn",
  "legacyMessagesSent",
  "legacyMessagesReceived",
  "pairThreads",
  "loansOpen",
  "loansOpenIn",
  "copies",
  "copyPhotos",
  "completions",
  "goals",
  "collections",
  "categories",
  "circlesOwned",
  "household",
  "domainEvents",
] as const;
type Phase = (typeof PHASES)[number];

const phaseValidator = v.union(
  v.literal("attachments"),
  v.literal("reveals"),
  v.literal("gpsViews"),
  v.literal("circleParticipants"),
  v.literal("typing"),
  v.literal("blocksOut"),
  v.literal("blocksIn"),
  v.literal("reports"),
  v.literal("invitesOut"),
  v.literal("invitesIn"),
  v.literal("offersOut"),
  v.literal("offersIn"),
  v.literal("householdInvitesOut"),
  v.literal("householdInvitesIn"),
  v.literal("householdJoinRequestsOut"),
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
  v.literal("presence"),
  v.literal("exchangesOpen"),
  v.literal("exchangesOpenIn"),
  v.literal("legacyMessagesSent"),
  v.literal("legacyMessagesReceived"),
  v.literal("pairThreads"),
  v.literal("loansOpen"),
  v.literal("loansOpenIn"),
  v.literal("copies"),
  v.literal("copyPhotos"),
  v.literal("completions"),
  v.literal("goals"),
  v.literal("collections"),
  v.literal("categories"),
  v.literal("circlesOwned"),
  v.literal("household"),
  v.literal("domainEvents"),
);

type Page = { isDone: boolean; continueCursor: string };

// A DM or exchange thread nobody can read any more: none of its participants has a users row. A
// tombstoned account (open CSAM escalation, users.deleteUser) still has one, so its threads are
// kept for the preservation. A circle thread is never orphaned this way: it goes with its circle
// (sharing/purgeDeletedCircle).
const isOrphanedPairThread = async (
  ctx: MutationCtx,
  thread: Doc<"threads">,
): Promise<boolean> => {
  if (thread.subjectKind === "circle") return false;
  for (const memberId of thread.participants) {
    if ((await ctx.db.get(memberId)) !== null) return false;
  }
  return true;
};

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
    case "circleParticipants": {
      const page = await ctx.db
        .query("threadParticipants")
        .withIndex("by_member", (q) => q.eq("memberId", memberId))
        .paginate(opts);
      for (const row of page.page) {
        const thread = await ctx.db
          .query("threads")
          .withIndex("by_aggregate_id", (q) =>
            q.eq("aggregateId", row.threadAggregateId),
          )
          .unique();
        if (thread && thread.subjectKind !== "circle") continue;
        if (thread) {
          await ctx.db.patch(thread._id, {
            participants: thread.participants.filter((id) => id !== memberId),
          });
        }
        await ctx.db.delete(row._id);
      }
      return page;
    }
    case "typing": {
      const page = await ctx.db
        .query("typingIndicators")
        .withIndex("by_member", (q) => q.eq("memberId", memberId))
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
    case "householdJoinRequestsOut": {
      // Every request to join they sent, whatever its status, with the
      // household_join_request_received notification about it in the admin's inbox.
      const page = await ctx.db
        .query("householdJoinRequests")
        .withIndex("by_requester", (q) => q.eq("requesterId", memberId))
        .paginate(opts);
      for (const row of page.page) {
        await deleteInviteNotificationsAbout(
          ctx,
          row.adminId,
          "household_join_request_received",
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
      for (const row of page.page) {
        // The link's landing counter (social/recordInviteLanding) goes with it.
        for (const { key } of inviteLandingBudget(row._id)) {
          const counter = await ctx.db
            .query("rateLimits")
            .withIndex("by_key", (q) => q.eq("key", key))
            .unique();
          if (counter) await ctx.db.delete(counter._id);
        }
        await ctx.db.delete(row._id);
      }
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
      // Their own counters, one row per limit name at most: a fixed handful of point lookups.
      for (const name of Object.keys(RATE_LIMITS) as RateLimitName[]) {
        const row = await ctx.db
          .query("rateLimits")
          .withIndex("by_key", (q) => q.eq("key", `${name}:${memberId}`))
          .unique();
        if (row) await ctx.db.delete(row._id);
      }
      // The per-pair counters name other members too and can be many, so these are batched. Each
      // deleted row leaves its index, so a next run simply takes the next rows and needs no cursor.
      const asActor = await ctx.db
        .query("rateLimits")
        .withIndex("by_pair_actor", (q) => q.eq("pairActorId", memberId))
        .take(opts.numItems);
      for (const row of asActor) await ctx.db.delete(row._id);
      const asTarget = await ctx.db
        .query("rateLimits")
        .withIndex("by_pair_target", (q) => q.eq("pairTargetId", memberId))
        .take(opts.numItems);
      for (const row of asTarget) await ctx.db.delete(row._id);
      return {
        isDone:
          asActor.length < opts.numItems && asTarget.length < opts.numItems,
        continueCursor: "",
      };
    }
    case "presence": {
      // One settings row, and one component row per room (the heartbeat allowlists three rooms):
      // a fixed handful, never paged. Listing first removes only rooms they are in, offline ones
      // included, and covers every room the component holds for them.
      const prefs = await ctx.db
        .query("presencePreferences")
        .withIndex("by_member", (q) => q.eq("memberId", memberId))
        .unique();
      if (prefs) await ctx.db.delete(prefs._id);
      const rooms = await presence.listUser(ctx, memberId as string, false);
      for (const { roomId } of rooms) {
        await presence.removeRoomUser(ctx, roomId, memberId as string);
      }
      return { isDone: true, continueCursor: "" };
    }
    case "exchangesOpen":
      return cancelOpenExchanges(ctx, memberId, "initiator", opts);
    case "exchangesOpenIn":
      return cancelOpenExchanges(ctx, memberId, "recipient", opts);
    case "legacyMessagesSent":
    case "legacyMessagesReceived": {
      // The legacy exchange chat, both directions. A row conversation/backfill copied into its
      // exchange thread is a duplicate and goes; one never copied is the only copy of that message
      // and is kept (counted, so the owner can run the backfill before dropping the table).
      const sent = phase === "legacyMessagesSent";
      const page = await (
        sent
          ? ctx.db
              .query("messages")
              .withIndex("by_sender", (q) => q.eq("senderId", memberId))
          : ctx.db
              .query("messages")
              .withIndex("by_receiver", (q) => q.eq("receiverId", memberId))
      ).paginate(opts);
      let kept = 0;
      for (const row of page.page) {
        if (await isCopiedLegacyMessage(ctx, row._id)) {
          await ctx.db.delete(row._id);
        } else {
          kept += 1;
        }
      }
      if (page.page.length > 0) {
        logEvent({
          event: "conversation.purgeLegacyMessages",
          outcome: "success",
          member_id: memberId,
          side: sent ? "sender" : "receiver",
          deleted: page.page.length - kept,
          kept_unmigrated: kept,
        });
      }
      return page;
    }
    case "pairThreads": {
      // Their DM and exchange threads (circle seats went in circleParticipants). A thread none of
      // whose participants has an account left is purged whole by purgeOrphanThread, in its own
      // batches; one the other party still has stays readable for them.
      const page = await ctx.db
        .query("threadParticipants")
        .withIndex("by_member", (q) => q.eq("memberId", memberId))
        .paginate(opts);
      for (const row of page.page) {
        const thread = await threadRowByAggregateId(ctx, row.threadAggregateId);
        if (thread && (await isOrphanedPairThread(ctx, thread))) {
          await ctx.scheduler.runAfter(
            0,
            internal.conversation.purgeMemberMessagingData.purgeOrphanThread,
            { threadAggregateId: thread.aggregateId },
          );
        }
      }
      return page;
    }
    case "loansOpen":
      return closeOpenLoans(ctx, memberId, "lender", opts);
    case "loansOpenIn":
      return closeOpenLoans(ctx, memberId, "borrower", opts);
    case "copies":
      return deleteOwnCopies(ctx, memberId, opts);
    case "copyPhotos":
      return deleteUploadedCopyPhotos(ctx, memberId, opts);
    case "completions":
      return purgeCompletions(ctx, memberId, opts);
    case "goals":
    case "categories":
      return deleteOwnRows(ctx, memberId, phase, opts);
    case "collections":
      return deleteCollections(ctx, memberId, opts);
    case "circlesOwned":
      return handOverOwnedCircles(ctx, memberId, opts);
    case "household":
      return leaveHousehold(ctx, memberId);
    case "domainEvents":
      return scrubMemberEvents(ctx, memberId, opts);
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
    const numItems =
      batchSize ??
      (current === "domainEvents" ? EVENT_SCRUB_BATCH_SIZE : PURGE_BATCH_SIZE);
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
      next === "domainEvents" && current !== "domainEvents"
        ? EVENT_SCRUB_DELAY_MS
        : 0,
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

/**
 * Purge a DM or exchange thread none of whose participants has an account left (the pairThreads
 * phase schedules it once the last of them is deleted): its messages, attachments (held and
 * quarantined ones excepted), typing and participant rows, then the thread row, PURGE_BATCH_SIZE
 * rows per run, rescheduling itself until the thread is gone. Re-checks the thread on every run, so
 * a duplicate schedule is harmless and a stale one (the thread is gone) does nothing.
 */
export const purgeOrphanThread = internalMutation({
  args: { threadAggregateId: v.string() },
  handler: async (ctx, { threadAggregateId }) => {
    const thread = await threadRowByAggregateId(ctx, threadAggregateId);
    if (!thread || !(await isOrphanedPairThread(ctx, thread))) return;
    const deleted = await purgeThreadBatch(ctx, thread, PURGE_BATCH_SIZE);
    if (deleted >= PURGE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal.conversation.purgeMemberMessagingData.purgeOrphanThread,
        { threadAggregateId },
      );
      return;
    }
    logEvent({
      event: "conversation.purgeOrphanThread",
      outcome: "success",
      thread_id: threadAggregateId,
      subject_kind: thread.subjectKind,
    });
  },
});

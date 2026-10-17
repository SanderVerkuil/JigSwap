import type {
  NotificationActAction,
  NotificationActionStaleError,
  NotificationActResult,
  NotificationResolvedAs,
} from "@jigswap/contracts";
import {
  NotificationApplicationError,
  toNotificationId,
  type NotificationSubject,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { acceptHouseholdInviteUseCase } from "../household/acceptHouseholdInvite";
import { declineHouseholdInviteUseCase } from "../household/declineHouseholdInvite";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { approveFollowRequestUseCase } from "../social/approveFollowRequest";
import { declineFollowRequestUseCase } from "../social/declineFollowRequest";
import { followMemberUseCase } from "../social/followMember";
import { toConvexError } from "./errors";
import { markNotificationReadUseCase } from "./markNotificationRead";
import {
  createNotificationViewCache,
  currentFollowRequest,
  resolveNotificationView,
} from "./resolveNotificationView";

const actionValidator = v.union(
  v.literal("follow_back"),
  v.literal("approve_follow_request"),
  v.literal("approve_and_follow_back"),
  v.literal("decline_follow_request"),
  v.literal("accept_household_invite"),
  v.literal("decline_household_invite"),
);

// What each action resolves to, should the post-action view not carry a resolved state.
const RESOLVED_AFTER: Record<NotificationActAction, NotificationResolvedAs> = {
  follow_back: "following",
  approve_follow_request: "approved",
  approve_and_follow_back: "approved",
  decline_follow_request: "declined",
  accept_household_invite: "joined",
  decline_household_invite: "declined",
};

const stale = (resolvedAs: NotificationResolvedAs | undefined) =>
  new ConvexError<NotificationActionStaleError>({
    code: "NOTIFICATION_ACTION_STALE",
    ...(resolvedAs !== undefined ? { resolvedAs } : {}),
  });

// The actor -> viewer follow request the row points at: the stored request when it is still that
// pair's, else the pair's current request (a withdrawn-then-re-sent request has a new id). Same
// lookup as the read model, so act targets the request the view decided on.
const followRequestIdOf = async (
  ctx: MutationCtx,
  row: Doc<"notifications">,
  actorId: Id<"users">,
  viewerId: Id<"users">,
): Promise<string | null> => {
  const subject = row.subject as NotificationSubject | undefined;
  if (subject?.kind === "followRequest") {
    const stored = await ctx.db
      .query("followRequests")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", subject.requestId),
      )
      .first();
    if (stored?.requesterId === actorId && stored.targetId === viewerId) {
      return stored.aggregateId;
    }
  }
  const current = await currentFollowRequest(ctx, actorId, viewerId);
  return current?.aggregateId ?? null;
};

// One inline action on one of the caller's notifications. The client sends only the notification
// id and the action: every target (member, follow request, household invite) comes from the row's
// stored refs, and the action must still be in the live view's availableActions (the same rules as
// listMyNotificationViews). It then runs the same use case as the matching public mutation and
// marks the row read, all in this one transaction.
export const act = mutation({
  args: { notificationId: v.string(), action: actionValidator },
  handler: async (ctx, args): Promise<NotificationActResult> => {
    const memberId = await requireMember(ctx);
    const viewerId = memberId as unknown as Id<"users">;

    const row = await ctx.db
      .query("notifications")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", args.notificationId),
      )
      .unique();
    const viewerIsAdmin = await isAdmin(ctx);
    // Someone else's row reads exactly like a missing one, so act never confirms an id exists.
    const view =
      row && row.userId === viewerId
        ? await resolveNotificationView(
            ctx,
            viewerId,
            row,
            createNotificationViewCache({ viewerIsAdmin }),
          )
        : null;
    if (!row || !view) {
      throw toConvexError(
        NotificationApplicationError.notificationNotFound(
          toNotificationId(args.notificationId),
        ),
      );
    }
    if (!view.availableActions.includes(args.action)) {
      throw stale(view.resolvedAs);
    }

    const actorId = row.actorIds?.[0];
    const subject = row.subject as NotificationSubject | undefined;
    switch (args.action) {
      case "follow_back": {
        if (!actorId) throw stale(view.resolvedAs);
        await followMemberUseCase(ctx, memberId, { followeeId: actorId });
        break;
      }
      case "approve_follow_request":
      case "approve_and_follow_back":
      case "decline_follow_request": {
        const requestId = actorId
          ? await followRequestIdOf(ctx, row, actorId, viewerId)
          : null;
        if (!actorId || !requestId) throw stale(view.resolvedAs);
        if (args.action === "decline_follow_request") {
          await declineFollowRequestUseCase(ctx, memberId, { requestId });
        } else {
          await approveFollowRequestUseCase(ctx, memberId, { requestId });
          if (args.action === "approve_and_follow_back") {
            await followMemberUseCase(ctx, memberId, { followeeId: actorId });
          }
        }
        break;
      }
      case "accept_household_invite":
      case "decline_household_invite": {
        if (subject?.kind !== "householdInvite") throw stale(view.resolvedAs);
        const invite = { inviteId: subject.inviteId };
        if (args.action === "accept_household_invite") {
          await acceptHouseholdInviteUseCase(ctx, memberId, invite);
        } else {
          await declineHouseholdInviteUseCase(ctx, memberId, invite);
        }
        break;
      }
    }

    await markNotificationReadUseCase(ctx, memberId, {
      notificationId: args.notificationId,
    });

    // Report the state the next read will show: re-resolve the row against the post-action facts.
    const after = await resolveNotificationView(
      ctx,
      viewerId,
      row,
      createNotificationViewCache({ viewerIsAdmin }),
    );
    return { resolvedAs: after?.resolvedAs ?? RESOLVED_AFTER[args.action] };
  },
});

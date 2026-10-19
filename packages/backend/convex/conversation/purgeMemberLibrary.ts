import {
  makeDeleteCircle,
  makeLeaveHousehold,
  makePostSystemMessage,
  toCircleId,
  toExchangeId,
  toMemberId,
  TRADE_EVENT_BODY,
} from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { householdDeps } from "../household/adapters/deps";
import { isPreservedBlob } from "../lib/imageModeration/quarantine";
import { makeNotify } from "../notifications/adapters/makeNotify";
import { convexCircleRepository } from "../sharing/adapters/convexCircleRepository";
import { inProcessEventPublisher as sharingEventPublisher } from "../sharing/adapters/inProcessEventPublisher";
import { systemClock } from "../sharing/adapters/systemClock";
import { convexThreadRepository } from "./adapters/convexThreadRepository";
import { messageIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { toConvexError } from "./errors";

// Phase bodies of the account-deletion purge (conversation/purgeMemberMessagingData) for what the
// member left outside messaging: their open trades and loans, their library copies, photos,
// completions, goals, collections and personal categories, the circles they own and their
// household. Each takes one page of the member's rows and returns the page, so runPhase keeps the
// one-phase-per-run, cursor-reschedule contract.

type PageOpts = { cursor: string | null; numItems: number };
type Page = { isDone: boolean; continueCursor: string };

// An exchange still in flight: it reserves its copies (library/adapters/convexCopyReservationPort).
// "disputed" is terminal in the Exchange state machine and can follow a completed settlement (the
// copies already moved), so it is trade history and stays, like completed/rejected/cancelled.
const OPEN_EXCHANGE = new Set(["proposed", "accepted"]);

/**
 * Tell the other party, when their account is still active: a trade_cancelled_member_deleted
 * notification (in-app, and push or email when their preferences turn those on), with the deleted
 * member as its actor so it reads as "Deleted member", and a system row in the exchange's thread
 * when it has one. A thread is never opened for this.
 */
const announceCancellation = async (
  ctx: MutationCtx,
  row: Doc<"exchanges">,
  memberId: Id<"users">,
): Promise<void> => {
  const otherId =
    row.initiatorId === memberId ? row.recipientId : row.initiatorId;
  if ((await ctx.db.get(otherId))?.isActive !== true) return;
  const exchangeId = row.aggregateId;
  await makeNotify(ctx)({
    memberId: toMemberId(otherId),
    type: "trade_cancelled_member_deleted",
    params: {},
    relatedId: row._id,
    actorId: toMemberId(memberId),
    ...(exchangeId !== undefined && {
      subject: { kind: "exchange" as const, exchangeId },
    }),
  });
  if (exchangeId === undefined) return;
  const threads = convexThreadRepository(ctx);
  const thread = await threads.findByExchange(toExchangeId(exchangeId));
  if (!thread) return;
  const posted = await makePostSystemMessage({
    threads,
    messageIds: messageIdGenerator,
    events: inProcessEventPublisher(ctx),
    clock: systemClock,
  })({
    threadId: thread.id,
    body: TRADE_EVENT_BODY.cancelled_member_deleted,
    tradeEvent: { kind: "cancelled_member_deleted" },
  });
  if (posted.isErr) throw toConvexError(posted.error);
};

/**
 * Cancel the member's open exchanges on one side (they proposed it, or it was proposed to them).
 * Written directly, not through the Exchange aggregate: its cancel is the initiator's move and its
 * decline the recipient's, and neither fits a deletion. No Exchange event is emitted (so the
 * ordinary trade_cancelled notification and "Exchange cancelled" row do not fire); the other party
 * is told through announceCancellation instead. The row keeps both parties and reads as cancelled.
 */
export const cancelOpenExchanges = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
  side: "initiator" | "recipient",
  opts: PageOpts,
): Promise<Page> => {
  const page = await (
    side === "initiator"
      ? ctx.db
          .query("exchanges")
          .withIndex("by_initiator", (q) => q.eq("initiatorId", memberId))
      : ctx.db
          .query("exchanges")
          .withIndex("by_recipient", (q) => q.eq("recipientId", memberId))
  ).paginate(opts);
  const now = Date.now();
  for (const row of page.page) {
    if (!OPEN_EXCHANGE.has(row.status)) continue;
    await ctx.db.patch(row._id, { status: "cancelled", updatedAt: now });
    await announceCancellation(ctx, row, memberId);
  }
  return page;
};

/**
 * Close the member's open loans on one side (they lent the copy, or borrowed it) as returned, and
 * give the copy back to its owner (`heldBy` cleared: an unset holder is the owner). Written
 * directly: the Loan aggregate's returnByBorrower/recallByOwner are the parties' own moves. The
 * loan row stays as the copy's history. A copy the member lent is deleted by the copies phase.
 */
export const closeOpenLoans = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
  side: "lender" | "borrower",
  opts: PageOpts,
): Promise<Page> => {
  const page = await (
    side === "lender"
      ? ctx.db
          .query("loans")
          .withIndex("by_lender", (q) =>
            q.eq("lenderId", memberId).eq("status", "open"),
          )
      : ctx.db
          .query("loans")
          .withIndex("by_borrower", (q) =>
            q.eq("borrowerId", memberId).eq("status", "open"),
          )
  ).paginate(opts);
  const now = Date.now();
  for (const loan of page.page) {
    await ctx.db.patch(loan._id, { status: "returned", closedAt: now });
    const copy = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", loan.copyId))
      .unique();
    if (copy && copy.heldBy !== undefined) {
      await ctx.db.patch(copy._id, { heldBy: undefined, updatedAt: now });
    }
  }
  return page;
};

// Delete a stored blob unless a CSAM escalation preserves it (lib/imageModeration/quarantine).
// Tolerates a blob that is already gone (a rejected photo's, or a re-encode swap's original).
const deleteBlob = async (ctx: MutationCtx, fileId: Id<"_storage">) => {
  if (await isPreservedBlob(ctx, fileId)) return;
  try {
    await ctx.storage.delete(fileId);
  } catch {
    // Already gone; nothing references it.
  }
};

/**
 * Delete one copy photo of a deleted member with its blob and its discussion comments. The keep
 * rule mirrors library/removeCopyPhoto and message attachments (messageAttachments
 * removeForDeletedMember): a quarantined photo (CSAM hash match) is kept whole, row and blob, for
 * the escalation; a blob an escalation preserves is never deleted. When the photo is a copy's
 * cover, the cover falls back to the catalogue image.
 */
const deleteCopyPhoto = async (
  ctx: MutationCtx,
  image: Doc<"ownedPuzzleImages">,
): Promise<void> => {
  if (image.moderationStatus === "quarantined") return;
  const copy = await ctx.db.get(image.ownedPuzzleId);
  if (copy?.coverImageId === image._id) {
    await ctx.db.patch(copy._id, { coverImageId: undefined });
  }
  const comments = await ctx.db
    .query("photoComments")
    .withIndex("by_photo", (q) => q.eq("photoId", image._id))
    .collect();
  for (const comment of comments) await ctx.db.delete(comment._id);
  await ctx.db.delete(image._id);
  await deleteBlob(ctx, image.fileId);
};

/**
 * Remove a completion's photos: its completionImages sidecars and every blob either the row's
 * `photos` or a sidecar references (they differ briefly around a moderation re-encode, as in
 * solving/deleteCompletion). A quarantined sidecar is kept, like a quarantined copy photo.
 */
const deleteCompletionPhotos = async (
  ctx: MutationCtx,
  completion: Doc<"completions">,
): Promise<void> => {
  const aggregateId = completion.aggregateId;
  const images = aggregateId
    ? await ctx.db
        .query("completionImages")
        .withIndex("by_completion", (q) => q.eq("completionId", aggregateId))
        .collect()
    : [];
  const kept = new Set<string>();
  for (const image of images) {
    if (image.moderationStatus === "quarantined") {
      kept.add(image.fileId);
      continue;
    }
    await ctx.db.delete(image._id);
  }
  const fileIds = new Set([
    ...completion.photos,
    ...images.map((image) => image.fileId),
  ]);
  for (const fileId of fileIds) {
    if (!kept.has(fileId)) await deleteBlob(ctx, fileId);
  }
};

const deleteCompletion = async (
  ctx: MutationCtx,
  completion: Doc<"completions">,
): Promise<void> => {
  await deleteCompletionPhotos(ctx, completion);
  await ctx.db.delete(completion._id);
};

/**
 * Delete a copy the member OWNS, with what hangs off it: collection memberships, copy reviews,
 * circle shares, copy-scoped comments, its photos (deleteCopyPhoto's keep rule) and the member's
 * own completions on it. Other members' completions on it (a borrower's solve) are theirs and
 * stay, carrying their copySnapshot, as when an owner deletes a copy. Exchanges, loans and custody
 * entries that name the copy stay as history, as for any deleted copy.
 */
const deleteOwnCopy = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
  copy: Doc<"ownedPuzzles">,
): Promise<void> => {
  const memberships = await ctx.db
    .query("collectionMembers")
    .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", copy._id))
    .collect();
  for (const row of memberships) await ctx.db.delete(row._id);

  const reviews = await ctx.db
    .query("copyReviews")
    .withIndex("by_copy", (q) => q.eq("copyId", copy._id))
    .collect();
  for (const row of reviews) await ctx.db.delete(row._id);

  const aggregateId = copy.aggregateId;
  if (aggregateId) {
    const shares = await ctx.db
      .query("circleCopyShares")
      .withIndex("by_copy", (q) => q.eq("copyId", aggregateId))
      .collect();
    for (const row of shares) await ctx.db.delete(row._id);
  }

  const comments = await ctx.db
    .query("puzzleComments")
    .withIndex("by_copy", (q) => q.eq("copyId", copy._id))
    .collect();
  for (const row of comments) await ctx.db.delete(row._id);

  const images = await ctx.db
    .query("ownedPuzzleImages")
    .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", copy._id))
    .collect();
  for (const image of images) await deleteCopyPhoto(ctx, image);

  const completions = await ctx.db
    .query("completions")
    .withIndex("by_user_owned_puzzle", (q) =>
      q.eq("userId", memberId).eq("ownedPuzzleId", copy._id),
    )
    .collect();
  for (const row of completions) await deleteCompletion(ctx, row);

  await ctx.db.delete(copy._id);
};

/**
 * The copies the member owns NOW (`ownedPuzzles.by_owner`), and only those: a copy they sold,
 * swapped or gave away has another owner and is never selected, so its History (custody entries,
 * completions, loans) is left whole.
 */
export const deleteOwnCopies = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
  opts: PageOpts,
): Promise<Page> => {
  const page = await ctx.db
    .query("ownedPuzzles")
    .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
    .paginate(opts);
  for (const copy of page.page) await deleteOwnCopy(ctx, memberId, copy);
  return page;
};

/** Their remaining copy photos, on copies other members own: deleted with their blobs. */
export const deleteUploadedCopyPhotos = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
  opts: PageOpts,
): Promise<Page> => {
  const page = await ctx.db
    .query("ownedPuzzleImages")
    .withIndex("by_uploader", (q) => q.eq("uploaderId", memberId))
    .paginate(opts);
  for (const image of page.page) await deleteCopyPhoto(ctx, image);
  return page;
};

/**
 * Their remaining completions. One on a copy someone else owns now is part of that copy's History:
 * the row stays (it renders as the departed member) without its photos. Any other (no copy, or the
 * copy is gone) is personal activity and is deleted with its photos.
 */
export const purgeCompletions = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
  opts: PageOpts,
): Promise<Page> => {
  const page = await ctx.db
    .query("completions")
    .withIndex("by_user", (q) => q.eq("userId", memberId))
    .paginate(opts);
  for (const completion of page.page) {
    const copy = completion.ownedPuzzleId
      ? await ctx.db.get(completion.ownedPuzzleId)
      : null;
    if (copy && copy.ownerId !== memberId) {
      await deleteCompletionPhotos(ctx, completion);
      if (completion.photos.length > 0) {
        await ctx.db.patch(completion._id, {
          photos: [],
          updatedAt: Date.now(),
        });
      }
      continue;
    }
    await deleteCompletion(ctx, completion);
  }
  return page;
};

/** Their goals and personal categories: own rows nothing else references. */
export const deleteOwnRows = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
  table: "goals" | "categories",
  opts: PageOpts,
): Promise<Page> => {
  const page = await (
    table === "goals"
      ? ctx.db
          .query("goals")
          .withIndex("by_user", (q) => q.eq("userId", memberId))
      : ctx.db
          .query("categories")
          .withIndex("by_user", (q) => q.eq("userId", memberId))
  ).paginate(opts);
  for (const row of page.page) await ctx.db.delete(row._id);
  return page;
};

/** Their collections and wishlists, with whatever memberships their deleted copies left. */
export const deleteCollections = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
  opts: PageOpts,
): Promise<Page> => {
  const page = await ctx.db
    .query("collections")
    .withIndex("by_user", (q) => q.eq("userId", memberId))
    .paginate(opts);
  for (const collection of page.page) {
    const members = await ctx.db
      .query("collectionMembers")
      .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
      .collect();
    for (const row of members) await ctx.db.delete(row._id);
    await ctx.db.delete(collection._id);
  }
  return page;
};

// Whether the member can still take something over: their users row exists and is active (a
// tombstoned account is inactive).
const isActiveMember = async (ctx: MutationCtx, memberId: Id<"users">) =>
  (await ctx.db.get(memberId))?.isActive === true;

/**
 * Who takes a circle over from its departing owner: the longest-standing active Admin, else the
 * longest-standing active member, else nobody. A departed member's seat is skipped.
 */
const successorOf = async (
  ctx: MutationCtx,
  circle: Doc<"circles">,
): Promise<Id<"users"> | null> => {
  const seats = circle.memberships
    .filter((seat) => seat.memberId !== circle.ownerId)
    .sort(
      (a, b) =>
        Number(b.permission === "Admin") - Number(a.permission === "Admin") ||
        a.joinedAt - b.joinedAt,
    );
  for (const seat of seats) {
    if (await isActiveMember(ctx, seat.memberId)) return seat.memberId;
  }
  return null;
};

/**
 * The circles they own: each goes to its successor (Circle.handOverOwnership; the repository save
 * keeps the circleMembers projection in step), their own seat staying as a departed seat. A circle
 * nobody active is left in is deleted through the owner's own delete path (makeDeleteCircle, as
 * them, confirming its name), whose CircleDeleted reaction schedules sharing/purgeDeletedCircle.
 */
export const handOverOwnedCircles = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
  opts: PageOpts,
): Promise<Page> => {
  const page = await ctx.db
    .query("circles")
    .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
    .paginate(opts);
  const circles = convexCircleRepository(ctx);
  for (const row of page.page) {
    // Every circle is written by the domain repository, which keys on aggregateId.
    if (!row.aggregateId) continue;
    const circleId = toCircleId(row.aggregateId);
    const successor = await successorOf(ctx, row);
    if (successor) {
      const circle = await circles.findById(circleId);
      if (!circle) continue;
      // The successor is a seat of this circle, so the hand-over cannot be refused.
      if (circle.handOverOwnership(toMemberId(successor)).isOk) {
        await circles.save(circle);
      }
      continue;
    }
    const result = await makeDeleteCircle({
      circles,
      events: sharingEventPublisher(ctx),
      clock: systemClock,
    })({
      circleId,
      actorId: toMemberId(memberId),
      confirmName: row.name,
    });
    // Refused only if the circle changed under us; the purge carries on rather than stall.
    if (result.isErr) {
      console.warn("purge: circle not deleted", circleId, result.error.code);
    }
  }
  return page;
};

/**
 * Take them out of their household through the leave use case: when they were its admin the
 * longest-standing remaining member is promoted, and when they were its last member it is
 * dissolved. The household model has no adult/child distinction, so "another adult takes over" is
 * exactly that promotion rule. Co-members whose accounts are already gone (deleted before this
 * purge covered households) leave first, the same way, so the promotion can only land on an active
 * member, and a household with nobody active left is dissolved.
 */
export const leaveHousehold = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
): Promise<Page> => {
  const seat = await ctx.db
    .query("householdMembers")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .first();
  if (seat) {
    const seats = await ctx.db
      .query("householdMembers")
      .withIndex("by_household", (q) => q.eq("householdId", seat.householdId))
      .collect();
    const departed: Id<"users">[] = [];
    for (const other of seats) {
      if (other.memberId === memberId) continue;
      if (!(await isActiveMember(ctx, other.memberId))) {
        departed.push(other.memberId);
      }
    }
    const leave = makeLeaveHousehold(householdDeps(ctx));
    for (const leaver of [...departed, memberId]) {
      const result = await leave({ actorId: toMemberId(leaver) });
      // Refused only if the household changed under us; the purge carries on rather than stall.
      if (result.isErr) {
        console.warn("purge: household not left", result.error.code);
      }
    }
  }
  return { isDone: true, continueCursor: "" };
};

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  deleteEventMembers,
  eventMembersBackfilled,
} from "../events/eventMembers";

// The last phase of the account-deletion purge (conversation/purgeMemberMessagingData; spec
// 2026-10-19 deleted member ghost, phase 9): the durable event log (`domainEvents`) keeps no trace
// that points at the deleted member. Their own activity-feed events go; every other event that
// names them is scrubbed. Admin, CSAM and moderation records live in their own tables and are not
// touched here. Some events name no member at all, only a copy (CopyDetailsUpdated carried the
// copy's free-text notes before events/recordAndSchedule stopped recording them): those lose
// their personal fields once the copy is gone (scrubDeletedCopyEvent).

// What a scrubbed payload says where it named the member.
export const DELETED_MEMBER = "deleted-member";

// Personal data an event may have copied from the member (identity, profile, their own library
// labels and notes). Dropped from a payload that names them, wherever it sits in the payload.
const PERSONAL_FIELDS = new Set([
  "email",
  "clerkId",
  "name",
  "displayName",
  "username",
  "avatar",
  "bio",
  "location",
  "notes",
  "collectionName",
  "categoryName",
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Every string in the payload equal to `memberId` becomes DELETED_MEMBER.
const replaceMember = (
  value: unknown,
  memberId: string,
): { value: unknown; mentions: boolean } => {
  if (value === memberId) return { value: DELETED_MEMBER, mentions: true };
  if (Array.isArray(value)) {
    let mentions = false;
    const items = value.map((item) => {
      const next = replaceMember(item, memberId);
      mentions ||= next.mentions;
      return next.value;
    });
    return { value: items, mentions };
  }
  if (isPlainObject(value)) {
    let mentions = false;
    const entries = Object.entries(value).map(([key, item]) => {
      const next = replaceMember(item, memberId);
      mentions ||= next.mentions;
      return [key, next.value] as const;
    });
    return { value: Object.fromEntries(entries), mentions };
  }
  return { value, mentions: false };
};

const hasPersonalField = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasPersonalField);
  if (isPlainObject(value)) {
    return Object.entries(value).some(
      ([key, item]) => PERSONAL_FIELDS.has(key) || hasPersonalField(item),
    );
  }
  return false;
};

const dropPersonalFields = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(dropPersonalFields);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !PERSONAL_FIELDS.has(key))
        .map(([key, item]) => [key, dropPersonalFields(item)]),
    );
  }
  return value;
};

/**
 * The payload with the member's id replaced by DELETED_MEMBER and the personal fields dropped, or
 * null when the payload does not name the member (it is left as it is).
 */
export const scrubPayload = (payload: unknown, memberId: string): unknown => {
  const replaced = replaceMember(payload, memberId);
  return replaced.mentions ? dropPersonalFields(replaced.value) : null;
};

// Whether the event's dispatch finished (processedAt or failedAt set): only such an event is
// rewritten, so no subscriber reads a scrubbed payload.
const isDispatched = (event: Doc<"domainEvents">) =>
  event.processedAt !== undefined || event.failedAt !== undefined;

// Copy lookups of one page, by aggregateId (a page often names the same copy many times).
export type CopyExists = Map<string, boolean>;

/**
 * An event keyed by a copy alone (`copyId`, the copy's aggregateId) cannot be attributed to its
 * owner by id: CopyDetailsUpdated carries the owner's free-text notes and no member id. Once that
 * copy no longer exists (the copies phase deleted it, or its owner did), the personal fields are
 * dropped from the payload (the copy id stays). Keyed on the copy being gone rather than on
 * recorded copy ids, so the rule needs no state across the purge's runs, is idempotent, and works
 * the same for the live purge, an in-flight straggler picked up later, and accounts deleted
 * before it existed (conversation/backfillDeletedMemberData). Nothing reads these fields of a
 * dispatched event. Returns whether the event needs (or, unless `dryRun`, got) the rewrite.
 */
export const scrubDeletedCopyEvent = async (
  ctx: MutationCtx,
  event: Doc<"domainEvents">,
  copyExists: CopyExists,
  dryRun = false,
): Promise<boolean> => {
  const payload: unknown = event.payload;
  if (!isDispatched(event) || !isPlainObject(payload)) return false;
  const copyId = payload.copyId;
  if (typeof copyId !== "string" || !hasPersonalField(payload)) return false;
  let exists = copyExists.get(copyId);
  if (exists === undefined) {
    exists =
      (await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
        .first()) !== null;
    copyExists.set(copyId, exists);
  }
  if (exists) return false;
  if (!dryRun) {
    await ctx.db.patch(event._id, { payload: dropPersonalFields(payload) });
  }
  return true;
};

// The activity-feed events a member's own action recorded (social/getActivityFeed reads them by
// name), with the payload field that names the acting member. They are deleted with the member, so
// a departed member's solves and acquisitions leave their followers' feeds instead of lingering
// there as a "deleted member" entry. ExchangeCompleted names no member (the feed reads its
// parties from the exchange row) and stays.
const OWN_FEED_EVENTS: Readonly<Record<string, string>> = {
  CompletionRecorded: "userId",
  CompletionStarted: "userId",
  CopyAcquired: "ownerId",
};

const isOwnFeedEvent = (event: Doc<"domainEvents">, memberId: string) => {
  const field = OWN_FEED_EVENTS[event.name];
  const payload: unknown = event.payload;
  return (
    field !== undefined && isPlainObject(payload) && payload[field] === memberId
  );
};

/**
 * Take the member out of one dispatched event: their own feed event is deleted with its lookup
 * rows; any other event that names them is scrubbed (scrubPayload) and loses their lookup row.
 * Returns false, changing nothing, when the payload does not name them.
 */
const takeMemberOut = async (
  ctx: MutationCtx,
  event: Doc<"domainEvents">,
  memberId: Id<"users">,
): Promise<boolean> => {
  const scrubbed = scrubPayload(event.payload, memberId);
  if (scrubbed === null) return false;
  if (isOwnFeedEvent(event, memberId)) {
    await deleteEventMembers(ctx, event._id);
    await ctx.db.delete(event._id);
  } else {
    await ctx.db.patch(event._id, { payload: scrubbed });
    await deleteEventMembers(ctx, event._id, memberId);
  }
  return true;
};

// Lookup rows read per run in index mode: each costs the event read plus a few index reads and
// writes, so a run takes fewer of them than events in a scan page.
export const EVENT_INDEX_BATCH_SIZE = 200;

// The phase's cursor says which walk it belongs to, so a purge that started paging the whole log
// finishes that way even if the lookup backfill completes meanwhile. A cursor without a prefix is a
// scan cursor from before the lookup existed.
const SCAN = "scan:";
const INDEX = "index:";

const resume = async (
  ctx: MutationCtx,
  cursor: string | null,
): Promise<{ mode: typeof SCAN | typeof INDEX; cursor: string | null }> => {
  if (cursor === null) {
    return {
      mode: (await eventMembersBackfilled(ctx)) ? INDEX : SCAN,
      cursor: null,
    };
  }
  if (cursor.startsWith(INDEX)) {
    return { mode: INDEX, cursor: cursor.slice(INDEX.length) };
  }
  if (cursor.startsWith(SCAN)) {
    return { mode: SCAN, cursor: cursor.slice(SCAN.length) };
  }
  return { mode: SCAN, cursor };
};

/**
 * One page of the member's events: their own feed events are deleted, every other payload that
 * names them is scrubbed (takeMemberOut). Once the domainEventMembers backfill has finished
 * (events/eventMembers), the page is the member's lookup rows (by_member), so the run touches only
 * their events. Before that it is a page of the whole log, which also drops the personal fields of
 * copy-keyed events whose copy is gone (scrubDeletedCopyEvent; such fields are no longer recorded,
 * and events/redactPayloads strips older ones, so the index walk needs no such pass). Only
 * dispatched events are rewritten; an event still in flight (with its lookup row) is dispatched
 * within seconds, and the backfill (conversation/backfillDeletedMemberData) picks up such a
 * straggler later.
 */
export const scrubMemberEvents = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
  opts: { cursor: string | null; numItems: number },
): Promise<{ isDone: boolean; continueCursor: string }> => {
  const { mode, cursor } = await resume(ctx, opts.cursor);
  if (mode === INDEX) {
    const page = await ctx.db
      .query("domainEventMembers")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .paginate({
        cursor,
        numItems: Math.min(opts.numItems, EVENT_INDEX_BATCH_SIZE),
      });
    for (const row of page.page) {
      const event = await ctx.db.get(row.eventId);
      if (event && !isDispatched(event)) continue;
      if (!event || !(await takeMemberOut(ctx, event, memberId))) {
        await ctx.db.delete(row._id); // its event is gone or no longer names them
      }
    }
    return { isDone: page.isDone, continueCursor: INDEX + page.continueCursor };
  }
  const page = await ctx.db
    .query("domainEvents")
    .paginate({ cursor, numItems: opts.numItems });
  const copyExists: CopyExists = new Map();
  for (const event of page.page) {
    if (!isDispatched(event)) continue;
    if (!(await takeMemberOut(ctx, event, memberId))) {
      await scrubDeletedCopyEvent(ctx, event, copyExists);
    }
  }
  return { isDone: page.isDone, continueCursor: SCAN + page.continueCursor };
};

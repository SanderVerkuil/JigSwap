import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// The last phase of the account-deletion purge (conversation/purgeMemberMessagingData; spec
// 2026-10-19 deleted member ghost, phase 9): the durable event log (`domainEvents`) keeps no trace
// that points at the deleted member. Admin, CSAM and moderation records live in their own tables
// and are not touched here.

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

/**
 * One page of `domainEvents`: rewrite every payload that names the member. Only events whose
 * dispatch finished (processedAt or failedAt set) are rewritten, so no subscriber reads a scrubbed
 * payload; an event still in flight is dispatched within seconds, and the backfill
 * (conversation/backfillDeletedMemberData) picks up such a straggler later.
 */
export const scrubMemberEvents = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
  opts: { cursor: string | null; numItems: number },
): Promise<{ isDone: boolean; continueCursor: string }> => {
  const page = await ctx.db.query("domainEvents").paginate(opts);
  for (const event of page.page) {
    if (event.processedAt === undefined && event.failedAt === undefined) {
      continue;
    }
    const payload = scrubPayload(event.payload, memberId);
    if (payload !== null) await ctx.db.patch(event._id, { payload });
  }
  return page;
};

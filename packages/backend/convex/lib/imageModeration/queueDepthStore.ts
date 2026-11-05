import { internalQuery, type QueryCtx } from "../../_generated/server";
import { recheckStateOf } from "./hashRecheckPool";
import type { ModerationTable } from "./moderationPool";

// The database side of the moderation queue-depth log (lib/imageModeration/queueDepth, every 15
// minutes from crons.ts). Per moderated table it reads:
// - the photos still "pending" a moderation verdict (by_moderation_status), and when the
//   longest-waiting one was last touched, as the stalled sweep counts it (stalledSweep: updatedAt;
//   box art: an admin's "Check again", else the upload);
// - the photos held unpublished for a CSAM hash RE-check (by_hash_check_pending, then the
//   re-check pool's own "waiting" rule, hashRecheckPool.recheckStateOf).
// Each read stops after QUEUE_DEPTH_SCAN_CAP rows, so a large backlog costs a bounded read; the
// count is then flagged `capped` (the backlog is at least that big, and the oldest wait is the
// oldest among the rows read: the index returns them oldest-created first).

/** Rows read per table and per index; a count that reaches it is reported as capped. */
export const QUEUE_DEPTH_SCAN_CAP = 500;

const TABLES: readonly ModerationTable[] = [
  "copy",
  "completion",
  "boxArt",
  "message",
  "circleIcon",
];

export type ModerationQueueDepth = {
  table: ModerationTable;
  /** Photos pending a moderation verdict, counted up to QUEUE_DEPTH_SCAN_CAP. */
  pending: number;
  /** When the longest-waiting pending photo was last touched; null when none is pending. */
  oldestPendingSince: number | null;
  /** Photos held unpublished for a CSAM hash re-check, counted up to QUEUE_DEPTH_SCAN_CAP. */
  hashWaiting: number;
  /** Either read reached the cap: the real count is at least what is reported. */
  capped: boolean;
};

type HashRow = Parameters<typeof recheckStateOf>[0];

type TableRows = { pendingSince: number[]; hashRows: HashRow[] };

const take = QUEUE_DEPTH_SCAN_CAP + 1;

// The pending rows (as when each was last touched) and the rows on the hash-check index, of one
// table, at most `take` of each.
const readTable = async (
  ctx: QueryCtx,
  table: ModerationTable,
): Promise<TableRows> => {
  switch (table) {
    case "copy":
    case "completion": {
      const name = table === "copy" ? "ownedPuzzleImages" : "completionImages";
      const pending = await ctx.db
        .query(name)
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", "pending"),
        )
        .take(take);
      const hashRows = await ctx.db
        .query(name)
        .withIndex("by_hash_check_pending", (q) =>
          q.gt("hashCheckPendingSince", 0),
        )
        .take(take);
      return { pendingSince: pending.map((row) => row.updatedAt), hashRows };
    }
    case "boxArt": {
      const pending = await ctx.db
        .query("boxArtUploads")
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", "pending"),
        )
        .take(take);
      const hashRows = await ctx.db
        .query("boxArtUploads")
        .withIndex("by_hash_check_pending", (q) =>
          q.gt("hashCheckPendingSince", 0),
        )
        .take(take);
      return {
        pendingSince: pending.map((row) => row.recheckedAt ?? row.createdAt),
        hashRows,
      };
    }
    case "message": {
      const pending = await ctx.db
        .query("messageAttachments")
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", "pending"),
        )
        .take(take);
      const hashRows = await ctx.db
        .query("messageAttachments")
        .withIndex("by_hash_check_pending", (q) =>
          q.gt("hashCheckPendingSince", 0),
        )
        .take(take);
      return {
        pendingSince: pending.map((row) => row.updatedAt),
        // A shared location has no hash check (never on this index); narrowed for the type.
        hashRows: hashRows.flatMap((row) =>
          row.kind === "image" ? [row] : [],
        ),
      };
    }
    case "circleIcon": {
      const pending = await ctx.db
        .query("circleIcons")
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", "pending"),
        )
        .take(take);
      const hashRows = await ctx.db
        .query("circleIcons")
        .withIndex("by_hash_check_pending", (q) =>
          q.gt("hashCheckPendingSince", 0),
        )
        .take(take);
      return { pendingSince: pending.map((row) => row.updatedAt), hashRows };
    }
  }
};

/** The moderation backlog of every moderated table (see the module comment). */
export const readModerationQueueDepth = internalQuery({
  args: {},
  handler: async (ctx): Promise<ModerationQueueDepth[]> => {
    const depths: ModerationQueueDepth[] = [];
    for (const table of TABLES) {
      const { pendingSince, hashRows } = await readTable(ctx, table);
      const hashWaiting = hashRows.filter(
        (row) => recheckStateOf(row).waiting,
      ).length;
      depths.push({
        table,
        pending: Math.min(pendingSince.length, QUEUE_DEPTH_SCAN_CAP),
        oldestPendingSince:
          pendingSince.length > 0 ? Math.min(...pendingSince) : null,
        hashWaiting: Math.min(hashWaiting, QUEUE_DEPTH_SCAN_CAP),
        capped:
          pendingSince.length > QUEUE_DEPTH_SCAN_CAP ||
          hashRows.length > QUEUE_DEPTH_SCAN_CAP,
      });
    }
    return depths;
  },
});

"use node";

import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { ingestToAxiom } from "../axiom";
import { logEvent } from "../logEvent";
import { HASH_RECHECK_POOL_PARALLELISM } from "./hashRecheckPool";
import { MODERATION_POOL_PARALLELISM } from "./moderationPool";

// Every 15 minutes (crons.ts): one wide event, "imageModeration.queueDepth", with the moderation
// backlog (queueDepthStore) next to the two pools' parallelism. The Workpool component logs its
// own per-minute report while busy, but only to the deployment log, which this project does not
// stream anywhere (not on Convex Pro, see lib/axiom); this event goes to Axiom too, so a burst
// that outruns MODERATION_POOL_PARALLELISM (photos waiting unpublished) or a hash-service outage
// that piles up re-checks is visible and alertable. Raising either parallelism is the owner's
// call: it depends on the production classifier's and hash service's concurrency limits.
export const logModerationQueueDepth = internalAction({
  args: {},
  handler: async (ctx) => {
    const depths = await ctx.runQuery(
      internal.lib.imageModeration.queueDepthStore.readModerationQueueDepth,
      {},
    );
    const now = Date.now();
    let oldest: { table: string; since: number } | null = null;
    for (const depth of depths) {
      if (depth.oldestPendingSince === null) continue;
      if (oldest === null || depth.oldestPendingSince < oldest.since) {
        oldest = { table: depth.table, since: depth.oldestPendingSince };
      }
    }
    await ingestToAxiom(
      logEvent({
        event: "imageModeration.queueDepth",
        outcome: "success",
        pending_total: depths.reduce((sum, depth) => sum + depth.pending, 0),
        pending_by_table: Object.fromEntries(
          depths.map((depth) => [depth.table, depth.pending]),
        ),
        oldest_pending_age_ms: oldest === null ? null : now - oldest.since,
        oldest_pending_table: oldest?.table ?? null,
        hash_waiting_total: depths.reduce(
          (sum, depth) => sum + depth.hashWaiting,
          0,
        ),
        hash_waiting_by_table: Object.fromEntries(
          depths.map((depth) => [depth.table, depth.hashWaiting]),
        ),
        capped: depths.some((depth) => depth.capped),
        pool_parallelism: MODERATION_POOL_PARALLELISM,
        hash_recheck_parallelism: HASH_RECHECK_POOL_PARALLELISM,
      }),
    );
  },
});

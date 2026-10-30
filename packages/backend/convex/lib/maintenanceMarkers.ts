import type { MutationCtx, QueryCtx } from "../_generated/server";

// One-shot maintenance steps that other code relies on record here that they are done (schema:
// maintenanceMarkers, one row per name). The step writes its own marker once its run proves the
// thing done; readers treat a missing marker as "not yet".
//
// - legacyCompletionSidecars: solving/backfillLegacyCompletionSidecars finished a real run over
//   the whole completions table and found no completion without an aggregateId, so every
//   completion photo has its completionImages sidecar and blob references see it. The storage
//   sweep (lib/storage/storageSweep) deletes nothing before this exists.
export type MaintenanceMarker = "legacyCompletionSidecars";

const markerRow = (ctx: QueryCtx, name: MaintenanceMarker) =>
  ctx.db
    .query("maintenanceMarkers")
    .withIndex("by_name", (q) => q.eq("name", name))
    .first();

export const hasMaintenanceMarker = async (
  ctx: QueryCtx,
  name: MaintenanceMarker,
): Promise<boolean> => (await markerRow(ctx, name)) !== null;

/** Record (or re-stamp) that `name` is done. */
export const recordMaintenanceMarker = async (
  ctx: MutationCtx,
  name: MaintenanceMarker,
): Promise<void> => {
  const completedAt = Date.now();
  const existing = await markerRow(ctx, name);
  if (existing) {
    await ctx.db.patch(existing._id, { completedAt });
  } else {
    await ctx.db.insert("maintenanceMarkers", { name, completedAt });
  }
};

import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { whatsNewManifest } from "./manifest";
import { publicationOf } from "./publications";

// Post-deploy hook (`convex run whatsNew/publishPending:publishPending`, see
// .github/workflows/convex-deploy.yml): start the whats_new notification fan-out for every
// notify:true manifest entry that has not been published yet. Safe on every deploy.
//
// Idempotency: the publication row and the first batch's scheduling commit in this one mutation,
// so an entry is either recorded and its fan-out started, or neither. A re-run (or a concurrent
// run, which Convex serialises via OCC on the by_entry read) sees the row and skips the entry.
export const publishPending = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ published: string[] }> => {
    const published: string[] = [];
    for (const entry of whatsNewManifest()) {
      if (!entry.notify || (await publicationOf(ctx, entry.id))) continue;
      await ctx.db.insert("whatsNewPublications", {
        entryId: entry.id,
        startedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(
        0,
        internal.whatsNew.notifyBatch.notifyBatch,
        { entryId: entry.id, cursor: null },
      );
      published.push(entry.id);
    }
    return { published };
  },
});

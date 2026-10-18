import { paginationOptsValidator } from "convex/server";
import { internalQuery } from "../_generated/server";

// Read-only, one-off check: how many `threadMessages` rows have kind "image". The public
// `postMessage` used to accept image messages with an arbitrary body (the web client never sent
// one), so the expected count is 0. Paginated so it stays inside the read limits on a large table;
// run it with the returned `continueCursor` until `isDone`, summing `imageCount`.
//   npx convex run conversation/countLegacyImageMessages:countLegacyImageMessages \
//     '{"paginationOpts":{"numItems":1000,"cursor":null}}'
export const countLegacyImageMessages = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db.query("threadMessages").paginate(paginationOpts);
    return {
      scanned: page.page.length,
      imageCount: page.page.filter((row) => row.kind === "image").length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

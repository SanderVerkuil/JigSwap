import type { MyPhotoOnFormerCopyView } from "@jigswap/contracts";
import { paginationOptsValidator, type PaginationResult } from "convex/server";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { canManageCopy } from "../household/copyAccess";
import { requireMember } from "../identity/requireMember";
import { isHashCleared } from "../lib/imageModeration/hashCheckFields";
import {
  renditionSources,
  thumbUrlOf,
} from "../lib/imageModeration/imageSources";
import { paginateBounded } from "../lib/pageSize";

// A page reads at most this many of the member's uploads whatever the client asks for.
const MAX_PAGE_SIZE = 50;

// The caller's own photos on copies they no longer manage, newest upload first, for "Privacy &
// safety" (SEC-38). A photo's uploader may always take it down (library/removeCopyPhoto), but once a
// copy changes hands its seller can't open the copy's page (library/canViewCopy), so this is how they
// reach that right. It shows them what they uploaded and what their data export already holds about
// it (insights/exportUserDataPage copyPhotos), and NOTHING about the copy: no id, no puzzle, no owner,
// no state. Rejected and quarantined photos are left out, as everywhere the uploader looks, and a
// photo whose hash check has not passed shows without a URL, like the gallery's placeholder.
//
// Filtered after reading, since a photo's row doesn't say who manages its copy now: a page holds at
// most numItems of the member's uploads and may come back short or empty with more to read. Each
// upload costs a copy read and, on a copy they don't own, the household reads of canManageCopy, so a
// page stays small whatever the size of their library.
export const listMyPhotosOnFormerCopies = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (
    ctx,
    { paginationOpts },
  ): Promise<PaginationResult<MyPhotoOnFormerCopyView>> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const uploads = await paginateBounded(
      ctx.db
        .query("ownedPuzzleImages")
        .withIndex("by_uploader", (q) => q.eq("uploaderId", me))
        .order("desc"),
      paginationOpts,
      MAX_PAGE_SIZE,
    );

    const page: MyPhotoOnFormerCopyView[] = [];
    for (const image of uploads.page) {
      const status = image.moderationStatus ?? "approved";
      if (status === "rejected" || status === "quarantined") continue;
      const copy = await ctx.db.get(image.ownedPuzzleId);
      if (!copy || (await canManageCopy(ctx, me, copy))) continue;
      const original = isHashCleared(image)
        ? await ctx.storage.getUrl(image.fileId)
        : null;
      page.push({
        imageId: image._id,
        url:
          original && status === "approved"
            ? thumbUrlOf(await renditionSources(ctx, image.fileId, original))
            : original,
        title: image.title,
        createdAt: image.createdAt,
      });
    }
    return { ...uploads, page };
  },
});

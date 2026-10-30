import { paginationOptsValidator } from "convex/server";
import { internalQuery } from "../_generated/server";
import {
  blobReferenceKinds,
  type BlobReferenceKind,
} from "../lib/imageModeration/blobReferences";

// The kinds that hold box art by design: the box-art listing and a change proposal that named it.
const BOX_ART_HOLDERS = new Set<BlobReferenceKind>([
  "boxArtListing",
  "proposedBoxArt",
]);

// Read-only, one-off forensics for SEC-01 (box-art storage ids reached members, who could attach
// one as their own photo and have it deleted). Pages over `puzzles` and reports:
//   missingImage     - definitions whose `image` blob no longer exists: the art was destroyed and
//                      has to be uploaded again (the admin list marks these "Missing cover").
//   heldByMemberRows - box art that another kind of row also holds (a copy or completion photo,
//                      a message photo, another definition, ...): attached, not yet destroyed.
// Legacy completion photos without a completionImages sidecar are only seen after
// solving/backfillLegacyCompletionSidecars has run. Run it with the returned `continueCursor`
// until `isDone`, collecting both lists (docs/deployment/one-shot-migrations.md):
//   npx convex run catalog/findDanglingBoxArt:findDanglingBoxArt \
//     '{"paginationOpts":{"numItems":100,"cursor":null}}'
export const findDanglingBoxArt = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db.query("puzzles").paginate(paginationOpts);
    const missingImage = [];
    const heldByMemberRows = [];
    for (const puzzle of page.page) {
      if (!puzzle.image) continue;
      const definition = {
        puzzleId: puzzle._id,
        aggregateId: puzzle.aggregateId,
        title: puzzle.title,
        status: puzzle.status,
        image: puzzle.image,
      };
      if ((await ctx.db.system.get(puzzle.image)) === null) {
        missingImage.push(definition);
        continue;
      }
      const heldBy = [
        ...(await blobReferenceKinds(ctx, puzzle.image, {
          except: puzzle._id,
        })),
      ].filter((kind) => !BOX_ART_HOLDERS.has(kind));
      if (heldBy.length > 0) heldByMemberRows.push({ ...definition, heldBy });
    }
    return {
      scanned: page.page.length,
      missingImage,
      heldByMemberRows,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

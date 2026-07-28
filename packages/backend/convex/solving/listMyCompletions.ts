import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  buildCopyViewContext,
  canViewCopyWithContext,
  type CopyViewContext,
} from "../library/canViewCopy";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";

// The navigation target for a completion row, most-specific-first: the viewer's own copy page,
// a copy page they can reach (currently holding, or visible per the copy gate), else the durable
// puzzle definition — and no link at all when even that anchor is gone. Ids are Convex doc _ids
// (what the routes parse); NEVER copySnapshot.copyId (the aggregate string).
type CompletionLink = {
  kind: "myCopy" | "copy" | "definition";
  id: string;
};

// Read side for the solving history view: the acting member's own completions, newest first.
// Auth-gated; photo storage ids are resolved to display items (url + pending flag) via
// resolvePhotoItems.
// Each row is also enriched with a navigation `link` and a `thumbnailUrl`, resolved once per
// DISTINCT copy/puzzle (many completions share one) since this is a self-facing read only.
export const listMyCompletions = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);
    const me = memberId as unknown as Id<"users">;

    const rows = await ctx.db
      .query("completions")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .order("desc")
      .collect();

    // Resolve display/navigation data once per DISTINCT copy/puzzle — many completions share one.
    const copyIds = [
      ...new Set(
        rows.flatMap((r) => (r.ownedPuzzleId ? [r.ownedPuzzleId] : [])),
      ),
    ];
    const puzzleIds = [
      ...new Set(rows.flatMap((r) => (r.puzzleId ? [r.puzzleId] : []))),
    ];

    const copies = new Map<string, Doc<"ownedPuzzles"> | null>();
    await Promise.all(
      copyIds.map(async (id) => copies.set(id as string, await ctx.db.get(id))),
    );
    const puzzles = new Map<string, Doc<"puzzles"> | null>();
    await Promise.all(
      puzzleIds.map(async (id) =>
        puzzles.set(id as string, await ctx.db.get(id)),
      ),
    );

    // Reachability per distinct copy. The circle-shared context is built lazily: only when some
    // copy is foreign and not currently held (the common all-own case never pays for it).
    // Sequential on purpose: the lazy ??= init and the ownerVisibility memo aren't safe to
    // parallelize — a Promise.all would race N context builds.
    let context: CopyViewContext | null = null;
    const reachable = new Map<string, boolean>();
    for (const [id, copy] of copies) {
      if (!copy) {
        reachable.set(id, false);
        continue;
      }
      if (copy.ownerId === me || copy.heldBy === me) {
        reachable.set(id, true);
        continue;
      }
      context ??= await buildCopyViewContext(ctx, me);
      reachable.set(id, await canViewCopyWithContext(ctx, copy, context));
    }

    // Thumbnails per distinct copy (cover — approved only — then box art) and per distinct
    // puzzle (box art) for rows whose copy is gone or unreachable.
    const copyThumbs = new Map<string, string | null>();
    await Promise.all(
      [...copies.entries()].map(async ([id, copy]) => {
        if (!copy || !reachable.get(id)) {
          copyThumbs.set(id, null);
          return;
        }
        const puzzle = copy.puzzleId ? await ctx.db.get(copy.puzzleId) : null;
        copyThumbs.set(id, await resolveCopyCoverUrl(ctx, copy, puzzle));
      }),
    );
    const puzzleThumbs = new Map<string, string | null>();
    await Promise.all(
      [...puzzles.entries()].map(async ([id, puzzle]) => {
        puzzleThumbs.set(
          id,
          puzzle?.image ? await ctx.storage.getUrl(puzzle.image) : null,
        );
      }),
    );

    return Promise.all(
      rows.map(async (row) => {
        const copyKey = row.ownedPuzzleId as string | undefined;
        const puzzleKey = row.puzzleId as string | undefined;
        const copy = copyKey ? (copies.get(copyKey) ?? null) : null;
        const copyReachable = copyKey
          ? (reachable.get(copyKey) ?? false)
          : false;
        const puzzle = puzzleKey ? (puzzles.get(puzzleKey) ?? null) : null;

        let link: CompletionLink | undefined;
        if (copy && copy.ownerId === me) {
          link = { kind: "myCopy", id: copy._id as string };
        } else if (copy && copyReachable) {
          link = { kind: "copy", id: copy._id as string };
        } else if (puzzle) {
          link = { kind: "definition", id: puzzle._id as string };
        }

        const thumbnailUrl =
          (copyKey && copyReachable ? copyThumbs.get(copyKey) : null) ??
          (puzzleKey ? puzzleThumbs.get(puzzleKey) : null) ??
          undefined;

        return {
          ...row,
          photoItems: await resolvePhotoItems(ctx, row),
          thumbnailUrl,
          link,
        };
      }),
    );
  },
});

// A completion photo ready for display: the served URL plus whether moderation is still pending.
export type PhotoItem = { url: string; pending: boolean };

// Resolve a completion's photos to displayable items. Photos whose moderation sidecar says
// "rejected" are dropped — and ONLY those. Pending stays visible but flagged `pending: true`
// (these reads are self-facing: the viewer is the uploader, matching the copy-gallery precedent);
// an ABSENT sidecar is a legacy photo, treated as approved (`pending: false`). Only domain rows
// (aggregateId present) can have sidecars, so legacy rows skip the join. Storage ids that no
// longer resolve to a URL are dropped. Shared with getCompletionHistory.
export const resolvePhotoItems = async (
  ctx: QueryCtx,
  row: Pick<Doc<"completions">, "aggregateId" | "photos">,
): Promise<PhotoItem[]> => {
  if (row.photos.length === 0) return [];
  const completionId = row.aggregateId;
  const statusByFile = new Map<string, string | undefined>();
  if (completionId) {
    const sidecars = await ctx.db
      .query("completionImages")
      .withIndex("by_completion", (q) => q.eq("completionId", completionId))
      .collect();
    for (const s of sidecars) {
      statusByFile.set(s.fileId as string, s.moderationStatus);
    }
  }
  const items = await Promise.all(
    row.photos.map(async (fileId): Promise<PhotoItem | null> => {
      const status = statusByFile.get(fileId as string);
      if (status === "rejected") return null;
      const url = await ctx.storage.getUrl(fileId);
      if (!url) return null;
      return { url, pending: status === "pending" };
    }),
  );
  return items.filter((item): item is PhotoItem => item !== null);
};

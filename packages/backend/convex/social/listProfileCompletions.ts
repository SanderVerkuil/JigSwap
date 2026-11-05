import { paginationOptsValidator, type PaginationOptions } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { canViewDefinition } from "../catalog/definitionVisibility";
import { requireMember } from "../identity/requireMember";
import { boxArtThumbUrl } from "../lib/imageModeration/boxArtUrl";
import { isHashCleared } from "../lib/imageModeration/hashCheckFields";
import { renditionSources } from "../lib/imageModeration/imageSources";
import { clampPaginationOpts } from "../lib/pageSize";
import {
  buildCopyViewContext,
  canViewCopyWithContext,
  type CopyViewContext,
} from "../library/canViewCopy";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";
import { canSeeProfileContent } from "./privacy";

// Where a profile completion row navigates (doc _ids, as the routes parse them).
type ProfileCompletionLink = {
  kind: "myCopy" | "copy" | "definition";
  id: string;
};

// A page holds 1 to MAX_PAGE_SIZE solves whatever the client asks for.
const MAX_PAGE_SIZE = 50;

// Social read: a member's FINISHED solves for their profile page, newest first, paginated.
// Auth-gated; gated by the profile unlock rule (canSeeProfileContent) — otherwise an empty,
// finished page. In-progress solves are NEVER listed here: they are opt-in and friends-only
// (`shareInProgress`), and getPublicProfile's `currentlySolving` already applies that gate.
//
// Each row is a narrow public projection — puzzle title/pieces, dates, solve time, approved photos,
// a thumbnail and a link. The member's private solve `notes`, the legacy rating/review columns and
// the copy snapshot (owner id, borrow flag) are not carried. The copy-specific thumbnail and link
// are only used when the viewer may reach that copy (canViewCopy); otherwise the puzzle definition,
// linked only when the viewer may open it (canViewDefinition, the definition page's own gate). The
// same gate decides whether a row without a snapshot title or piece count may quote the definition's
// live ones, so a non-approved definition's text never reaches a viewer it would refuse (SEC-34).
//
// Each row carries its `datePrecision` (absent = "day") for the "In 2023" / "Date unknown" label.
// Undated solves sort LAST (spec 2026-10-17 §3.2): the dated rows (day and year) page first,
// newest first, then the undated ones (see pageDatedThenUndated).
export const listProfileCompletions = query({
  args: { memberId: v.id("users"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await canSeeProfileContent(ctx, viewerId, args.memberId))) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const result = await pageDatedThenUndated(
      ctx,
      args.memberId,
      clampPaginationOpts(args.paginationOpts, MAX_PAGE_SIZE),
    );

    // Sequential: the lazily built copy-view context and its memo aren't Promise.all-safe.
    let context: CopyViewContext | null = null;
    const page = [];
    for (const row of result.page) {
      const copy = row.ownedPuzzleId
        ? await ctx.db.get(row.ownedPuzzleId)
        : null;
      let reachable = false;
      if (copy) {
        if (copy.ownerId === viewerId || copy.heldBy === viewerId) {
          reachable = true;
        } else {
          context ??= await buildCopyViewContext(ctx, viewerId);
          reachable = await canViewCopyWithContext(ctx, copy, context);
        }
      }
      const puzzleId =
        row.puzzleId ?? (copy && reachable ? copy.puzzleId : undefined);
      const puzzle = puzzleId ? await ctx.db.get(puzzleId) : null;
      const definitionVisible =
        puzzle !== null && (await canViewDefinition(ctx, puzzle, viewerId));

      let link: ProfileCompletionLink | undefined;
      if (copy && reachable) {
        link = {
          kind: copy.ownerId === viewerId ? "myCopy" : "copy",
          id: copy._id as string,
        };
      } else if (definitionVisible) {
        link = { kind: "definition", id: puzzle._id as string };
      }

      const thumbnailUrl =
        (copy && reachable
          ? await resolveCopyCoverUrl(ctx, copy, puzzle)
          : puzzle?.image
            ? await boxArtThumbUrl(ctx, puzzle.image)
            : null) ?? undefined;

      page.push({
        _id: row._id,
        title:
          row.copySnapshot?.title ??
          (definitionVisible ? puzzle.title : undefined),
        pieceCount:
          row.copySnapshot?.pieceCount ??
          (definitionVisible ? puzzle.pieceCount : undefined),
        startDate: row.startDate,
        endDate: row.endDate ?? row.startDate,
        completionTimeMinutes: row.completionTimeMinutes,
        datePrecision: row.datePrecision ?? ("day" as const),
        ...(await profilePhotos(ctx, row)),
        thumbnailUrl,
        link,
      });
    }
    return { ...result, page };
  },
});

// Two pagination phases behind one cursor: the member's finished DATED solves (newest first), then
// their UNDATED ones (newest first). The phase is a cursor prefix ("d:" / "u:") around Convex's own
// cursor; a null cursor starts the dated phase. Convex allows one `.paginate()` per call, so the
// page where the dated phase runs out may be short; it hands over to the undated phase with "u:".
// `endCursor` (sent by the client to keep pages contiguous) is decoded the same way.
type Phase = { undated: boolean; cursor: string | null };
const decodeCursor = (cursor: string): Phase => ({
  undated: cursor.startsWith("u:"),
  cursor: cursor.slice(2) || null,
});
const encodeCursor = (phase: Phase): string =>
  `${phase.undated ? "u:" : "d:"}${phase.cursor ?? ""}`;

const pageDatedThenUndated = async (
  ctx: QueryCtx,
  memberId: Id<"users">,
  opts: PaginationOptions,
): Promise<{
  page: Doc<"completions">[];
  isDone: boolean;
  continueCursor: string;
}> => {
  const start: Phase =
    opts.cursor === null
      ? { undated: false, cursor: null }
      : decodeCursor(opts.cursor);
  const end = opts.endCursor ? decodeCursor(opts.endCursor) : null;
  // Within the dated phase, a page only ends early when the client pinned its end there.
  const datedEnd = !start.undated && end && !end.undated ? end : null;

  const result = await ctx.db
    .query("completions")
    .withIndex("by_user_completed", (q) =>
      q.eq("userId", memberId).eq("isCompleted", true),
    )
    .order("desc")
    .filter((q) =>
      start.undated
        ? q.eq(q.field("datePrecision"), "unknown")
        : q.neq(q.field("datePrecision"), "unknown"),
    )
    .paginate({
      ...opts,
      cursor: start.cursor,
      endCursor: start.undated ? end?.cursor : datedEnd?.cursor,
    });

  if (start.undated) {
    return {
      page: result.page,
      isDone: result.isDone,
      continueCursor: encodeCursor({
        undated: true,
        cursor: result.continueCursor,
      }),
    };
  }
  const handOver = result.isDone && !datedEnd;
  return {
    page: result.page,
    isDone: false,
    continueCursor: encodeCursor(
      handOver
        ? { undated: true, cursor: null }
        : { undated: false, cursor: result.continueCursor },
    ),
  };
};

// Approved photos only: unlike the self-facing log (which shows pending with a badge), a profile is
// seen by others, so a photo awaiting moderation is never shown — it surfaces only as a blurhash
// placeholder (lib/blurhash: no URL, no id). Rejected photos appear in neither list. No sidecar =
// legacy = approved. `photoSrcSets` runs parallel to `photoUrls`: what each photo's tile picks from
// once it has renditions (null before), read only after the same gate. The URLs stay the originals,
// which a click opens.
const profilePhotos = async (
  ctx: QueryCtx,
  row: Pick<Doc<"completions">, "aggregateId" | "photos">,
): Promise<{
  photoUrls: string[];
  photoSrcSets: (string | null)[];
  pendingPhotos: { blurhash: string | null }[];
}> => {
  if (row.photos.length === 0) {
    return { photoUrls: [], photoSrcSets: [], pendingPhotos: [] };
  }
  const sidecarByFile = new Map<string, Doc<"completionImages">>();
  const completionId = row.aggregateId;
  if (completionId) {
    const sidecars = await ctx.db
      .query("completionImages")
      .withIndex("by_completion", (q) => q.eq("completionId", completionId))
      .collect();
    for (const s of sidecars) sidecarByFile.set(s.fileId as string, s);
  }
  const photoUrls: string[] = [];
  const photoSrcSets: (string | null)[] = [];
  const pendingPhotos: { blurhash: string | null }[] = [];
  for (const fileId of row.photos) {
    const sidecar = sidecarByFile.get(fileId as string);
    const status = sidecar?.moderationStatus ?? "approved";
    // No URL (and no blurhash) before the CSAM hash check has passed (hashCheckFields).
    const cleared = !sidecar || isHashCleared(sidecar);
    if (status === "approved" && cleared) {
      const url = await ctx.storage.getUrl(fileId);
      if (url) {
        photoUrls.push(url);
        const { srcSet } = await renditionSources(ctx, fileId, url);
        photoSrcSets.push(srcSet ?? null);
      }
    } else if (
      status === "approved" ||
      status === "pending" ||
      status === "unscored"
    ) {
      pendingPhotos.push({
        blurhash: cleared ? (sidecar?.blurhash ?? null) : null,
      });
    }
  }
  return { photoUrls, photoSrcSets, pendingPhotos };
};

import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
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

// Social read: a member's FINISHED solves for their profile page, newest first, paginated.
// Auth-gated; gated by the profile unlock rule (canSeeProfileContent) — otherwise an empty,
// finished page. In-progress solves are NEVER listed here: they are opt-in and friends-only
// (`shareInProgress`), and getPublicProfile's `currentlySolving` already applies that gate.
//
// Each row is a narrow public projection — puzzle title/pieces, dates, solve time, approved photos,
// a thumbnail and a link. The member's private solve `notes`, the legacy rating/review columns and
// the copy snapshot (owner id, borrow flag) are not carried. The copy-specific thumbnail and link
// are only used when the viewer may reach that copy (canViewCopy); otherwise the puzzle definition.
export const listProfileCompletions = query({
  args: { memberId: v.id("users"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await canSeeProfileContent(ctx, viewerId, args.memberId))) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const result = await ctx.db
      .query("completions")
      .withIndex("by_user_completed", (q) =>
        q.eq("userId", args.memberId).eq("isCompleted", true),
      )
      .order("desc")
      .paginate(args.paginationOpts);

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

      let link: ProfileCompletionLink | undefined;
      if (copy && reachable) {
        link = {
          kind: copy.ownerId === viewerId ? "myCopy" : "copy",
          id: copy._id as string,
        };
      } else if (puzzle) {
        link = { kind: "definition", id: puzzle._id as string };
      }

      const thumbnailUrl =
        (copy && reachable
          ? await resolveCopyCoverUrl(ctx, copy, puzzle)
          : puzzle?.image
            ? await ctx.storage.getUrl(puzzle.image)
            : null) ?? undefined;

      page.push({
        _id: row._id,
        title: row.copySnapshot?.title ?? puzzle?.title,
        pieceCount: row.copySnapshot?.pieceCount ?? puzzle?.pieceCount,
        startDate: row.startDate,
        endDate: row.endDate ?? row.startDate,
        completionTimeMinutes: row.completionTimeMinutes,
        photoUrls: await approvedPhotoUrls(ctx, row),
        thumbnailUrl,
        link,
      });
    }
    return { ...result, page };
  },
});

// Approved photos only: unlike the self-facing log (which shows pending with a badge), a profile is
// seen by others, so a photo awaiting moderation stays hidden. No sidecar = legacy = approved.
const approvedPhotoUrls = async (
  ctx: QueryCtx,
  row: Pick<Doc<"completions">, "aggregateId" | "photos">,
): Promise<string[]> => {
  if (row.photos.length === 0) return [];
  const statusByFile = new Map<string, string | undefined>();
  const completionId = row.aggregateId;
  if (completionId) {
    const sidecars = await ctx.db
      .query("completionImages")
      .withIndex("by_completion", (q) => q.eq("completionId", completionId))
      .collect();
    for (const s of sidecars)
      statusByFile.set(s.fileId as string, s.moderationStatus);
  }
  const urls = await Promise.all(
    row.photos.map(async (fileId) => {
      const status = statusByFile.get(fileId as string) ?? "approved";
      return status === "approved" ? await ctx.storage.getUrl(fileId) : null;
    }),
  );
  return urls.filter((url): url is string => url !== null);
};

import type { BrowseOwnedCopiesView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { clampLimit, clampOffset } from "../lib/pageSize";
import { blockedEitherWaySet } from "../social/blocks";
import { profileVisibilityOf, projectMemberIdentity } from "../social/privacy";
import { collectCircleSharedCopies } from "./circleSharedCopies";
import { viewerMayRequestCopy } from "./exchangeRoutes";
import { toCopyPuzzleView, toOwnedCopyView } from "./mappers";
import { isOpenAvailability, openListingWindow } from "./openListing";
import { resolveCopyCoverUrl } from "./resolveCoverUrl";

// Browse's candidate window (library/openListing.openListingWindow). It holds at most
// BROWSE_CANDIDATE_CAP copies the viewer may see, newest first. One owner's rows past
// BROWSE_PER_OWNER only fill room the other owners leave, and reading stops after
// BROWSE_READ_BUDGET rows or BROWSE_CANDIDATE_CAP distinct owners. The text, category, piece and
// difficulty filters run over the window, so past it `total` is a lower bound
// (`totalIsLowerBound`) and older listings are reachable through the definition filter
// (`puzzleId`, its own window). A bounded window can always be crowded by enough newer listings
// from enough members: these numbers make that take more than the read budget of newer open
// copies, not just one member's pile.
export const BROWSE_CANDIDATE_CAP = 1000;
export const BROWSE_PER_OWNER = 50;
export const BROWSE_READ_BUDGET = 3 * BROWSE_CANDIDATE_CAP;
// A page holds 1 to BROWSE_MAX_LIMIT copies whatever the client asks for (the web asks for 50); the
// offset is never negative.
export const BROWSE_MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

// Library read: browse OTHER members' available owned copies with filters. Rule 1 of Browse
// visibility: only OPEN copies are ever shown (library/openListing), including circle-shared ones.
// Candidates come from the `isOpen` indexes through openListingWindow, so closed copies are never
// read, and every gate that needs no puzzle (open, own copies, blocks, rule 2, condition) runs while
// the window fills: a copy the viewer can't see never takes a slot, and no member's pile of listings
// can push the others out (SEC-29). Auth gating, every puzzle-based filter
// (category/pieces/difficulty/search), the newest-first ordering, the owner join and offset/limit
// paging are preserved from legacy puzzles.browseOwnedPuzzles; the result maps to a typed paginated
// DTO.
export const browseOwnedPuzzles = query({
  args: {
    category: v.optional(v.id("adminCategories")),
    minPieceCount: v.optional(v.number()),
    maxPieceCount: v.optional(v.number()),
    difficulty: v.optional(
      v.union(
        v.literal("easy"),
        v.literal("medium"),
        v.literal("hard"),
        v.literal("expert"),
      ),
    ),
    condition: v.optional(
      v.union(
        v.literal("new_sealed"),
        v.literal("like_new"),
        v.literal("good"),
        v.literal("fair"),
        v.literal("poor"),
      ),
    ),
    searchTerm: v.optional(v.string()),
    // Narrow to copies of ONE catalogue definition (the puzzle's Convex _id). Typed as a string,
    // not v.id, because it arrives from a URL search param: a malformed value normalises to null
    // and yields an empty page instead of failing the whole query.
    puzzleId: v.optional(v.string()),
    includeOwnPuzzles: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BrowseOwnedCopiesView> => {
    const limit = clampLimit(args.limit, {
      fallback: DEFAULT_LIMIT,
      max: BROWSE_MAX_LIMIT,
    });
    const offset = clampOffset(args.offset);

    // Resolve the acting member (auth-gated, identical to legacy). The domain MemberId is the
    // user's Convex _id.
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const puzzleId =
      args.puzzleId === undefined
        ? undefined
        : ctx.db.normalizeId("puzzles", args.puzzleId);
    if (puzzleId === null) {
      return {
        ownedPuzzles: [],
        total: 0,
        hasMore: false,
        totalIsLowerBound: false,
      };
    }

    // Circle-shared copies the viewer may see (cross-context). Rule 1 applies to these too: a
    // copy must be OPEN to appear, even when reached via a circle. Build the set of circle-shared
    // copy ids for the window's rule 2 check, and keep the (open) rows so the union also adds any
    // open circle copy the window missed (e.g. a fellow member's open circle copy older than it).
    const circleShared = (
      await collectCircleSharedCopies(ctx, memberId)
    ).filter(
      (c) =>
        isOpenAvailability(c.availability) &&
        (!puzzleId || c.puzzleId === puzzleId),
    );
    const circleSharedIds = new Set(
      circleShared.map((c) => c._id as unknown as string),
    );

    // Resolve each distinct owner's profile visibility ONCE (cache by ownerId), so we never issue
    // N profile queries for N copies by the same owner.
    const visibilityCache = new Map<string, "public" | "private">();
    const ownerIsPublic = async (ownerId: Id<"users">): Promise<boolean> => {
      const key = ownerId as unknown as string;
      let cached = visibilityCache.get(key);
      if (cached === undefined) {
        cached = await profileVisibilityOf(ctx, ownerId);
        visibilityCache.set(key, cached);
      }
      return cached === "public";
    };

    // Copies of members blocked either way with the viewer are never shown (spec 2.6).
    const blockedIds = await blockedEitherWaySet(ctx, memberId);
    // The gates that need no puzzle, run as the window fills. Browse shows OTHER members' copies
    // (unless includeOwnPuzzles). Rule 2 (reachability): a copy is shown when its owner is PUBLIC,
    // or the copy is circle-shared with the viewer; a private, non-circle owner's copies are
    // excluded entirely (no row over the wire).
    const passesGates = (copy: Doc<"ownedPuzzles">) =>
      (args.includeOwnPuzzles || copy.ownerId !== memberId) &&
      !blockedIds.has(copy.ownerId) &&
      (!args.condition || copy.condition === args.condition);
    const window = await openListingWindow(
      ctx,
      puzzleId,
      {
        size: BROWSE_CANDIDATE_CAP,
        perOwner: BROWSE_PER_OWNER,
        readBudget: BROWSE_READ_BUDGET,
        maxOwners: BROWSE_CANDIDATE_CAP,
      },
      async (copy) =>
        passesGates(copy) &&
        (circleSharedIds.has(copy._id as unknown as string) ||
          (await ownerIsPublic(copy.ownerId))),
    );

    // The window, then UNION any open circle-shared copy it missed, de-duplicated by copy id.
    const shown: Doc<"ownedPuzzles">[] = [...window.rows];
    const seen = new Set(shown.map((c) => c._id as unknown as string));
    for (const copy of circleShared) {
      const id = copy._id as unknown as string;
      if (seen.has(id) || !passesGates(copy)) continue;
      shown.push(copy);
      seen.add(id);
    }

    // One read per distinct definition, not per copy: the window can hold many copies of one.
    const puzzleReads = new Map<string, Promise<Doc<"puzzles"> | null>>();
    const puzzleOf = (id: Id<"puzzles">) => {
      let read = puzzleReads.get(id);
      if (read === undefined) {
        read = ctx.db.get(id);
        puzzleReads.set(id, read);
      }
      return read;
    };
    // The puzzle-based filters match only the catalogue facts the card shows (`shown`, the same
    // projection toOwnedCopyView joins): for a copy of a definition that is not approved that is
    // its snapshot title, brand and pieces, so a search can't probe hidden description or tags.
    const withPuzzles = await Promise.all(
      shown.map(async (copy) => {
        const puzzle = await puzzleOf(copy.puzzleId);
        return { copy, puzzle, shown: toCopyPuzzleView(copy, puzzle) };
      }),
    );

    let filtered = withPuzzles;

    if (args.category) {
      filtered = filtered.filter(
        (i) =>
          i.shown?.category === args.category &&
          i.shown?.category !== undefined,
      );
    }
    if (args.minPieceCount !== undefined) {
      filtered = filtered.filter(
        (i) => i.shown && i.shown.pieceCount >= args.minPieceCount!,
      );
    }
    if (args.maxPieceCount !== undefined) {
      filtered = filtered.filter(
        (i) => i.shown && i.shown.pieceCount <= args.maxPieceCount!,
      );
    }
    if (args.difficulty) {
      filtered = filtered.filter(
        (i) => i.shown?.difficulty === args.difficulty,
      );
    }
    if (args.searchTerm) {
      const searchTerm = args.searchTerm.toLowerCase();
      filtered = filtered.filter(
        (i) =>
          i.shown &&
          (i.shown.title.toLowerCase().includes(searchTerm) ||
            (i.shown.description &&
              i.shown.description.toLowerCase().includes(searchTerm)) ||
            (i.shown.brand &&
              i.shown.brand.toLowerCase().includes(searchTerm)) ||
            (i.shown.tags &&
              i.shown.tags.some((tag) =>
                tag.toLowerCase().includes(searchTerm),
              ))),
      );
    }

    filtered.sort((a, b) => b.copy.createdAt - a.copy.createdAt);

    // The owner is projected through the identity chokepoint (salt = the copy's _id, as on the copy
    // page), so a hidden owner is anonymous and `ownerId` is only carried when they are revealed.
    const page = await Promise.all(
      filtered.slice(offset, offset + limit).map(async ({ copy, puzzle }) => {
        const {
          ownerId,
          owner: _unjoined,
          ...view
        } = toOwnedCopyView(copy, puzzle, {
          coverUrl: await resolveCopyCoverUrl(ctx, copy, puzzle),
        });
        const owner = await projectMemberIdentity(
          ctx,
          memberId,
          copy.ownerId,
          copy._id as string,
        );
        // A public owner's open copy is always requestable; otherwise the copy is here through a
        // circle, and the viewer's routes (circle level, household, mutual follow) decide.
        const viewerMayRequest =
          copy.ownerId !== memberId &&
          ((await ownerIsPublic(copy.ownerId)) ||
            (await viewerMayRequestCopy(ctx, memberId, copy)));
        return {
          ...view,
          ...(owner.anonymous ? {} : { ownerId }),
          owner,
          viewerMayRequest,
        };
      }),
    );

    return {
      ownedPuzzles: page,
      total: filtered.length,
      hasMore: offset + limit < filtered.length,
      totalIsLowerBound: window.cut,
    };
  },
});

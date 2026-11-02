import type { BrowseOwnedCopiesView } from "@jigswap/contracts";
import { foldDiacritics } from "@jigswap/domain";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { clampLimit, clampOffset } from "../lib/pageSize";
import { blockedEitherWaySet } from "../social/blocks";
import { profileVisibilityOf, projectMemberIdentity } from "../social/privacy";
import {
  circleShareCandidates,
  isCircleShareVisible,
} from "./circleSharedCopies";
import { viewerMayRequestCopy } from "./exchangeRoutes";
import { toCopyPuzzleView, toOwnedCopyView } from "./mappers";
import {
  decodeListingCursor,
  encodeListingCursor,
  isAtOrPastKey,
  isOpenAvailability,
  LISTING_HELD_OWNERS_MAX,
  listingKeyOf,
  publicListingsAfter,
  type ListingKey,
} from "./openListing";
import { resolveCopyCoverFields } from "./resolveCoverUrl";

// How many listing rows one call reads looking for a page, open or not. A page full of plain offers
// stops long before this. A filter that matches little comes back short, even empty, with the cursor
// where it stopped, and Load more carries on from there, so what a call costs doesn't grow with how
// many listings there are, and no pile of listings can hide older ones from a filter.
export const BROWSE_PAGE_READ_BUDGET = 500;
// A page holds 1 to BROWSE_MAX_LIMIT copies whatever the client asks for (the web asks for 48).
export const BROWSE_MAX_LIMIT = 50;
// How many rows of one page one member can take: half of the web's page. Their next row and all
// their older ones wait until every other listing has had its turn (see the walk below), so a pile
// of newer listings can't fill the pages in front of everyone else's, and a member who lists a
// batch of this size at once is left where they are.
export const BROWSE_PAGE_OWNER_SHARE = 24;
const DEFAULT_LIMIT = 20;

// Library read: browse OTHER members' available owned copies with filters, a page at a time. Rule 1
// of Browse visibility: only OPEN copies are ever shown (library/openListing), including
// circle-shared ones. Candidates come from the listing indexes, walked newest offer first from the
// client's `cursor` as far as this page needs (publicListingsAfter), so a call reads what it shows:
// closed copies and private owners' copies are never read, and rows nobody asked for stay out of its
// read set, so an unrelated listing further down the index re-runs nobody's subscription. Results are
// newest OFFER first (`listedAt`), so a copy offered today leads even if it was added long ago.
//
// Every filter runs while the page fills, so a copy the viewer can't see or didn't ask for never
// takes a slot. Auth gating and every filter (category/pieces/difficulty/search, condition, channel,
// own copies, blocks, rule 2) are preserved from legacy puzzles.browseOwnedPuzzles; the result maps
// to a typed paginated DTO. There is no total: counting matches would mean reading them all. `hasMore`
// says more may follow, and only a page that reached the end of the listings says there is none.
//
// No member takes more than BROWSE_PAGE_OWNER_SHARE rows of a page while others have listings left
// (SEC-29), and Load more reaches every row, each once. So the order is newest offer first, except
// that the rest of a pile comes after everyone else's. Past LISTING_HELD_OWNERS_MAX members the next
// ones stay in order, so enough accounts together can still fill pages, and a pile larger than the
// read budget still costs a viewer a Load more per BROWSE_PAGE_READ_BUDGET rows to get past: the
// walk has to read them to skip them, because the indexes don't hold the owner.
export const browseOwnedPuzzles = query({
  args: {
    // A string, not v.id, for the same reason as puzzleId below: it arrives from a URL search param.
    category: v.optional(v.string()),
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
    // Narrow to copies offered ANY of these ways (for trade / lend / sale). Applied while the page
    // fills, so a page and `hasMore` hold only matching copies. Absent or empty: no narrowing.
    availability: v.optional(
      v.array(
        v.union(
          v.literal("forTrade"),
          v.literal("forLend"),
          v.literal("forSale"),
        ),
      ),
    ),
    // Narrow to copies of ONE catalogue definition (the puzzle's Convex _id). Typed as a string,
    // not v.id, because it arrives from a URL search param: a malformed value normalises to null
    // and yields an empty page instead of failing the whole query.
    puzzleId: v.optional(v.string()),
    includeOwnPuzzles: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    // The previous page's continueCursor; absent for the first page.
    cursor: v.optional(v.union(v.string(), v.null())),
    // Sent by web builds from before cursors, which ask for pages by offset: the first page is
    // answered as ever and anything past it reads as the end of the list. Remove once they have aged
    // out.
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BrowseOwnedCopiesView> => {
    const limit = clampLimit(args.limit, {
      fallback: DEFAULT_LIMIT,
      max: BROWSE_MAX_LIMIT,
    });

    // Resolve the acting member (auth-gated, identical to legacy). The domain MemberId is the
    // user's Convex _id.
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const puzzleId =
      args.puzzleId === undefined
        ? undefined
        : ctx.db.normalizeId("puzzles", args.puzzleId);
    const category =
      args.category === undefined
        ? undefined
        : ctx.db.normalizeId("adminCategories", args.category);
    if (
      puzzleId === null ||
      category === null ||
      clampOffset(args.offset) > 0
    ) {
      return { ownedPuzzles: [], hasMore: false, continueCursor: null };
    }

    // Circle-shared copies the viewer may see (cross-context). Rule 1 applies to these too: a
    // copy must be OPEN to appear, even when reached via a circle. They are merged into the walk, so
    // an open circle copy the public index doesn't hold (a private owner's) takes its place by when
    // it was offered. Each is checked only when it reaches the page.
    const candidates = (await circleShareCandidates(ctx, memberId)).filter(
      ({ row }) =>
        isOpenAvailability(row.availability) &&
        (!puzzleId || row.puzzleId === puzzleId),
    );
    const candidateOf = new Map(candidates.map((c) => [c.row._id, c]));

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

    // One read per distinct definition, not per copy: a page can hold many copies of one.
    const puzzleReads = new Map<string, Promise<Doc<"puzzles"> | null>>();
    const puzzleOf = (id: Id<"puzzles">) => {
      let read = puzzleReads.get(id);
      if (read === undefined) {
        read = ctx.db.get(id);
        puzzleReads.set(id, read);
      }
      return read;
    };

    // The puzzle-based filters match only the catalogue facts the card shows (the same projection
    // toOwnedCopyView joins): for a copy of a definition that is not approved that is its snapshot
    // title, brand and pieces, so a search can't probe hidden description or tags.
    // Accents and case are ignored on both sides: "cafe" finds "Café".
    const fold = (text: string) => foldDiacritics(text).toLowerCase();
    const searchTerm = fold(args.searchTerm ?? "");
    const matches = (text: string) => fold(text).includes(searchTerm);
    const filtersByPuzzle =
      Boolean(category) ||
      args.minPieceCount !== undefined ||
      args.maxPieceCount !== undefined ||
      Boolean(args.difficulty) ||
      Boolean(searchTerm);
    const matchesPuzzleFilters = async (copy: Doc<"ownedPuzzles">) => {
      if (!filtersByPuzzle) return true;
      const shown = toCopyPuzzleView(copy, await puzzleOf(copy.puzzleId));
      if (!shown) return false;
      return (
        (!category || shown.category === category) &&
        (args.minPieceCount === undefined ||
          shown.pieceCount >= args.minPieceCount) &&
        (args.maxPieceCount === undefined ||
          shown.pieceCount <= args.maxPieceCount) &&
        (!args.difficulty || shown.difficulty === args.difficulty) &&
        (!searchTerm ||
          matches(shown.title) ||
          Boolean(shown.description && matches(shown.description)) ||
          Boolean(shown.brand && matches(shown.brand)) ||
          Boolean(shown.tags?.some(matches)))
      );
    };

    // Copies of members blocked either way with the viewer are never shown (spec 2.6).
    const blockedIds = await blockedEitherWaySet(ctx, memberId);
    // The cheap gates first, then the filters, then who may see it. Browse shows OTHER members'
    // copies (unless includeOwnPuzzles). Rule 2 (reachability): a copy is shown when its owner is
    // PUBLIC, or the copy is circle-shared with the viewer; a private, non-circle owner's copies are
    // excluded entirely (no row over the wire).
    const channels = args.availability ?? [];
    const belongsOnPage = async (copy: Doc<"ownedPuzzles">) => {
      if (
        !isOpenAvailability(copy.availability) ||
        (!args.includeOwnPuzzles && copy.ownerId === memberId) ||
        blockedIds.has(copy.ownerId) ||
        (args.condition && copy.condition !== args.condition) ||
        (channels.length > 0 &&
          !channels.some((channel) => copy.availability[channel])) ||
        !(await matchesPuzzleFilters(copy))
      ) {
        return false;
      }
      if (await ownerIsPublic(copy.ownerId)) return true;
      const candidate = candidateOf.get(copy._id);
      return (
        candidate !== undefined &&
        (await isCircleShareVisible(ctx, memberId, candidate))
      );
    };

    // Walk until the page is full and one more match shows there is more, or the read budget or the
    // listings run out. The next page starts after the last row looked at and kept out of this one,
    // so rows refused here are not read again.
    //
    // A member's row past their share of this page is passed over, and from there on all of theirs:
    // the cursor remembers from which place, so it costs no state per row. Once the walk reaches the
    // end it starts over for exactly those rows, on this page if it has room. Which rows wait is
    // decided by the place alone, so each row belongs to one pass. The second pass reads the whole
    // walk again, a budget at a time, which only a viewer past every other listing ever pays for.
    const rows: Doc<"ownedPuzzles">[] = [];
    let position = decodeListingCursor(args.cursor);
    let secondPass = position?.secondPass === true;
    const held = new Map<string, ListingKey>(
      (position?.held ?? []).map(([ownerId, ...from]) => [ownerId, from]),
    );
    const isHeld = (copy: Doc<"ownedPuzzles">) => {
      const from = held.get(copy.ownerId);
      return from !== undefined && isAtOrPastKey(copy, from);
    };
    const shownOnPage = new Map<string, number>();
    let scanned = 0;
    let hasMore = false;
    walk: for (;;) {
      for await (const { copy, cursor } of publicListingsAfter(
        ctx,
        puzzleId,
        position,
        candidates.map((c) => c.row),
      )) {
        if (scanned >= BROWSE_PAGE_READ_BUDGET) {
          hasMore = true;
          break walk;
        }
        scanned += 1;
        if (isHeld(copy) === secondPass && (await belongsOnPage(copy))) {
          if (rows.length === limit) {
            hasMore = true;
            break walk;
          }
          const shown = shownOnPage.get(copy.ownerId) ?? 0;
          if (
            !secondPass &&
            shown >= BROWSE_PAGE_OWNER_SHARE &&
            held.size < LISTING_HELD_OWNERS_MAX
          ) {
            held.set(copy.ownerId, listingKeyOf(copy));
          } else {
            shownOnPage.set(copy.ownerId, shown + 1);
            rows.push(copy);
          }
        }
        position = cursor;
      }
      if (secondPass || held.size === 0) break;
      secondPass = true;
      position = undefined;
    }

    // The owner is projected through the identity chokepoint (salt = the copy's _id, as on the copy
    // page), so a hidden owner is anonymous and `ownerId` is only carried when they are revealed.
    const page = await Promise.all(
      rows.map(async (copy) => {
        const puzzle = await puzzleOf(copy.puzzleId);
        const {
          ownerId,
          owner: _unjoined,
          ...view
        } = toOwnedCopyView(copy, puzzle, {
          ...(await resolveCopyCoverFields(ctx, copy, puzzle)),
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
      hasMore,
      continueCursor: hasMore
        ? encodeListingCursor({
            ...position,
            held:
              held.size > 0
                ? [...held].map(([ownerId, from]) => [ownerId, ...from])
                : undefined,
            secondPass: secondPass ? true : undefined,
          })
        : null,
    };
  },
});

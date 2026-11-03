import type { CircleId, OwnerId } from "@jigswap/domain";
import { toCopyId, toMemberId, toOwnerId } from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  isCopySharedInto,
  sharesOfCircleWithin,
} from "../sharing/adapters/circleCopyShares";
import { convexCircleRepository } from "../sharing/adapters/convexCircleRepository";
import { makeCircleAwareVisibilityPolicy } from "./adapters/circleAwareVisibilityPolicy";
import { convexCopyRepository } from "./adapters/convexCopyRepository";

// Cross-context read helper: the owned-copy rows shared into a circle the viewer belongs to AND that
// the circle-aware VisibilityPolicy says the viewer may see. Loads each shared copy as a domain
// aggregate, runs it through the policy (which delegates to Sharing's pure VisibilityPolicy), and
// returns the surviving rows for the browse union. Returns [] when the viewer is in no circle.
//
// A share only counts via a circle that (a) has a circleCopyShares row for THIS copy, (b) the viewer
// is currently a member of and (c) the copy's owner is currently a member of — membership meaning a
// `circleMembers` junction row, never a pending invite (#181). A copy with no such circle is dropped
// (so a stale share left behind after the owner left the circle exposes nothing), and the policy gets
// exactly those per-copy circles, never just any circle the viewer and owner happen to share.
//
// BOUNDED (#190): at most CIRCLE_SHARES_READ_PER_CIRCLE shares are read per circle, and
// CIRCLE_SHARES_READ_TOTAL across a viewer's circles, split evenly. A very busy circle's read goes
// round its members (sharing/adapters/circleCopyShares.sharesOfCircleWithin), so what one member
// shares can't take another's copy out of this set, and only a member's own older shares can drop out.
// That only affects the list surface built on it (Browse); every per-copy gate (canViewCopy /
// canViewCopyWithContext, the definition view) uses `isCircleSharedWithViewer` instead, which starts
// from the viewer's own circles up to MAX_VIEWER_CIRCLES_READ, so this cap can't hide a copy on its
// detail page.
export const CIRCLE_SHARES_READ_PER_CIRCLE = 200;
// Each share costs an index range for its copy, and Browse runs this on every page, so a member of
// many busy circles can't push its read past Convex's limit of 4,096 ranges per function.
export const CIRCLE_SHARES_READ_TOTAL = 600;
// Generous next to real use (a member in hundreds of friend circles is already extreme; each circle
// holds at most 50 members), while keeping the check well inside Convex's per-function read limits.
export const MAX_VIEWER_CIRCLES_READ = 500;
// The most index ranges the check takes in one function call, those circles included. Lists ask it
// row after row next to reads of their own, and all of it has to fit Convex's limit of 4,096.
export const MAX_CIRCLE_CLAUSE_RANGES = 1000;

const isMemberOf = async (
  ctx: QueryCtx,
  circleId: string,
  memberId: Id<"users">,
): Promise<boolean> =>
  (await ctx.db
    .query("circleMembers")
    .withIndex("by_circle_member", (q) =>
      q.eq("circleAggregateId", circleId).eq("memberId", memberId),
    )
    .first()) !== null;

// What one function call knows of the viewer's circles.
type ViewerCircles = {
  seats: { circleId: string; circle: Doc<"circles"> }[];
  // Which of them another member sits in too, once asked for.
  sharedWith: Map<Id<"users">, Promise<ViewerCircles["seats"]>>;
  rangesLeft: number;
};

const readViewerCircles = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
): Promise<ViewerCircles> => {
  const links = await ctx.db
    .query("circleMembers")
    .withIndex("by_member", (q) => q.eq("memberId", viewerId))
    .take(MAX_VIEWER_CIRCLES_READ + 1);
  const tooMany = links.length > MAX_VIEWER_CIRCLES_READ;
  const seats = await Promise.all(
    (tooMany ? [] : links).map(async ({ circleAggregateId: circleId }) => {
      // The collector only sees circles listForMember resolves: a viewer junction row AND an
      // existing circles row.
      const circle = await ctx.db
        .query("circles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
        .unique();
      return circle ? { circleId, circle } : null;
    }),
  );
  return {
    seats: seats.filter((seat) => seat !== null),
    sharedWith: new Map(),
    rangesLeft: tooMany ? 0 : MAX_CIRCLE_CLAUSE_RANGES - links.length,
  };
};

// Per function call, so a list asking row after row pays for the viewer's circles once.
const viewerCircleReads = new WeakMap<
  QueryCtx,
  Map<Id<"users">, Promise<ViewerCircles>>
>();

const viewerCirclesOf = (
  ctx: QueryCtx,
  viewerId: Id<"users">,
): Promise<ViewerCircles> => {
  // A mutation can change a circle between two checks, so it reads them each time. It asks about a
  // copy or two, not a list.
  if ("insert" in ctx.db) return readViewerCircles(ctx, viewerId);
  const reads = viewerCircleReads.get(ctx) ?? new Map();
  viewerCircleReads.set(ctx, reads);
  const read: Promise<ViewerCircles> =
    reads.get(viewerId) ?? readViewerCircles(ctx, viewerId);
  reads.set(viewerId, read);
  return read;
};

// Past the budget a lookup isn't made, and what it would have found doesn't count.
const takeRange = (viewer: ViewerCircles): boolean => viewer.rangesLeft-- > 0;

// The viewer's circles the member sits in too, once per member. Membership is the junction row (the
// embedded list is written with it, and only spares asking about the circles it doesn't name).
const seatsSharedWith = (
  ctx: QueryCtx,
  viewer: ViewerCircles,
  memberId: Id<"users">,
): Promise<ViewerCircles["seats"]> => {
  const known = viewer.sharedWith.get(memberId);
  if (known) return known;
  const read = (async () => {
    const seats = await Promise.all(
      viewer.seats
        .filter(({ circle }) =>
          circle.memberships.some((seat) => seat.memberId === memberId),
        )
        .map(async (seat) =>
          takeRange(viewer) && (await isMemberOf(ctx, seat.circleId, memberId))
            ? seat
            : null,
        ),
    );
    return seats.filter((seat) => seat !== null);
  })();
  viewer.sharedWith.set(memberId, read);
  return read;
};

// The single-copy form of the circle clause, with the same semantics as the batched collector below.
// It starts from the VIEWER's circles (circleMembers.by_member), never the copy's shares: how many
// circles a copy is shared into is up to its OWNER, and lists ask this row after row. Those circles
// are read once per function call, so a copy whose owner has no seat next to the viewer costs nothing
// more, whoever owns it and however much they share. One who has costs a point lookup per circle they
// have in common (by_circle_copy), and that takes the viewer's consent to grow: a member is only in
// circles they created or whose invite they accepted (no admin can seat anyone directly).
//
// Past MAX_VIEWER_CIRCLES_READ circles, or MAX_CIRCLE_CLAUSE_RANGES in one function call, it FAILS
// CLOSED (not circle-shared).
export const isCircleSharedWithViewer = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  row: Doc<"ownedPuzzles">,
): Promise<boolean> => {
  const copyId = row.aggregateId;
  if (copyId === undefined) return false;
  const qualifying = (await circlesSharingCopyWith(ctx, viewerId, row)).map(
    (circle) => circle.aggregateId as CircleId,
  );
  if (qualifying.length === 0) return false;
  const copy = await convexCopyRepository(
    ctx as unknown as MutationCtx,
  ).findById(toCopyId(copyId));
  if (!copy) return false;
  return makeCircleAwareVisibilityPolicy(() => qualifying).canView(
    toOwnerId(viewerId),
    copy,
  );
};

// The circles behind the clause above: every circle that holds a share of this copy and that the
// viewer and the copy's owner are both currently members of (same bounded reads). Exchange
// eligibility reads the viewer's permission level from these rows.
export const circlesSharingCopyWith = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  row: Doc<"ownedPuzzles">,
): Promise<Doc<"circles">[]> => {
  const copyId = row.aggregateId;
  if (copyId === undefined) return [];
  const viewer = await viewerCirclesOf(ctx, viewerId);
  const seats = await seatsSharedWith(ctx, viewer, row.ownerId);
  const sharing = await Promise.all(
    seats.map(async ({ circleId, circle }) =>
      takeRange(viewer) && (await isCopySharedInto(ctx, circleId, copyId))
        ? circle
        : null,
    ),
  );
  return sharing.filter((circle) => circle !== null);
};

// A copy shared into one of the viewer's circles, not yet checked: the row, and the viewer's circles
// holding a share of it.
export type CircleShareCandidate = {
  row: Doc<"ownedPuzzles">;
  into: CircleId[];
};

// The first half of the batched read: the viewer's circles, their shares as far as the read goes and
// those copies' rows. Cheap enough to run per page of a list. isCircleShareVisible decides each one.
export const circleShareCandidates = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
): Promise<CircleShareCandidate[]> => {
  const circles = convexCircleRepository(ctx);
  const myCircles = await circles.listForMember(toMemberId(viewerId));
  if (myCircles.length === 0) return [];
  const perCircle = Math.max(
    1,
    Math.min(
      CIRCLE_SHARES_READ_PER_CIRCLE,
      Math.floor(CIRCLE_SHARES_READ_TOTAL / myCircles.length),
    ),
  );

  // Resolve every copy shared into any of the viewer's circles (by CopyId aggregateId), remembering
  // which of the viewer's circles each copy was shared into.
  const sharedInto = new Map<string, CircleId[]>();
  for (const circle of myCircles) {
    const shares = await sharesOfCircleWithin(
      ctx,
      circle.id as string,
      circle.members.map(({ memberId }) => memberId as unknown as Id<"users">),
      perCircle,
    );
    for (const share of shares) {
      const into = sharedInto.get(share.copyId) ?? [];
      into.push(circle.id);
      sharedInto.set(share.copyId, into);
    }
  }
  const resolved = await Promise.all(
    [...sharedInto].map(async ([copyId, into]) => {
      const row = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
        .unique();
      return row ? { row, into } : null;
    }),
  );
  return resolved.filter((candidate) => candidate !== null);
};

// The second half: whether the viewer may see this copy through those circles. Only circles the
// copy's owner is still a member of count (junction probe per circle), and the policy sees exactly
// those.
export const isCircleShareVisible = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  { row, into }: CircleShareCandidate,
): Promise<boolean> => {
  const ownerIn = await Promise.all(
    into.map(async (circleId) =>
      (await ctx.db
        .query("circleMembers")
        .withIndex("by_circle_member", (q) =>
          q
            .eq("circleAggregateId", circleId as string)
            .eq("memberId", row.ownerId),
        )
        .first()) !== null
        ? circleId
        : null,
    ),
  );
  const qualifying = ownerIn.filter((c) => c !== null);
  if (qualifying.length === 0 || row.aggregateId === undefined) return false;
  // The copy repository only reads here (findById); a QueryCtx is structurally sufficient.
  const copy = await convexCopyRepository(
    ctx as unknown as MutationCtx,
  ).findById(toCopyId(row.aggregateId));
  if (!copy) return false;
  const owner = (id: Id<"users">): OwnerId => toOwnerId(id);
  return makeCircleAwareVisibilityPolicy(() => qualifying).canView(
    owner(viewerId),
    copy,
  );
};

// Both halves at once. Browse runs them apart, deciding a copy only when it reaches a page.
export const collectCircleSharedCopies = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
): Promise<Doc<"ownedPuzzles">[]> => {
  const candidates = await circleShareCandidates(ctx, viewerId);
  const visible = await Promise.all(
    candidates.map(async (candidate) =>
      (await isCircleShareVisible(ctx, viewerId, candidate))
        ? candidate.row
        : null,
    ),
  );
  return visible.filter((row) => row !== null);
};

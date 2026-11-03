import type { CircleId, OwnerId } from "@jigswap/domain";
import { toCopyId, toMemberId, toOwnerId } from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sharesOfCircleWithin } from "../sharing/adapters/circleCopyShares";
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
// canViewCopyWithContext, the definition view) uses `isCircleSharedWithViewer` instead, which reads
// that copy's own shares (capped by_copy, with a viewer-circle fallback that reaches the same decision
// up to MAX_VIEWER_CIRCLES_READ), so this cap can't hide a copy on its detail page.
export const CIRCLE_SHARES_READ_PER_CIRCLE = 200;
// Each share costs an index range for its copy, and Browse runs this on every page, so a member of
// many busy circles can't push its read past Convex's limit of 4,096 ranges per function.
export const CIRCLE_SHARES_READ_TOTAL = 600;
// A copy's shares are the owner's to multiply, and lists run this check per row, so past this few the
// check reads the viewer's own circles instead (see isCircleSharedWithViewer).
export const MAX_SHARES_READ_PER_COPY = 5;
// Generous next to real use (a member in hundreds of friend circles is already extreme; each circle
// holds at most 50 members), while keeping the fallback well inside Convex's per-function read limits.
export const MAX_VIEWER_CIRCLES_READ = 500;

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

// The single-copy form of the circle clause, with the same semantics as the batched collector below:
// reads only THIS copy's shares (circleCopyShares.by_copy) and, per share, probes the viewer's and the
// owner's junction rows, so the cost is O(shares of the copy), independent of the viewer's circles.
//
// The share count is OWNER-controlled (one copy can be shared into any number of solo circles), so
// at most MAX_SHARES_READ_PER_COPY shares are read by_copy, few enough that a list deciding row after
// row can't be pushed past Convex's limit of 4,096 ranges by what one owner does. Past that, the
// candidate circles come from the VIEWER's own memberships instead (circleMembers.by_member), each
// probed with a circleCopyShares.by_circle_copy point lookup. Both routes yield the same set of
// qualifying circles, so the decision is identical to the uncapped rule (no false negatives) as long as
// the viewer is in at most MAX_VIEWER_CIRCLES_READ circles. Beyond that the fallback FAILS CLOSED (not
// circle-shared). The viewer's own consent bounds that list: a member is only in circles they created
// or whose invite they accepted (no admin can seat anyone directly), so nobody else can inflate it.
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
  const shares = await ctx.db
    .query("circleCopyShares")
    .withIndex("by_copy", (q) => q.eq("copyId", copyId))
    .take(MAX_SHARES_READ_PER_COPY + 1);
  let candidateCircles: string[];
  if (shares.length <= MAX_SHARES_READ_PER_COPY) {
    candidateCircles = shares.map((s) => s.circleId);
  } else {
    const links = await ctx.db
      .query("circleMembers")
      .withIndex("by_member", (q) => q.eq("memberId", viewerId))
      .take(MAX_VIEWER_CIRCLES_READ + 1);
    if (links.length > MAX_VIEWER_CIRCLES_READ) return [];
    candidateCircles = (
      await Promise.all(
        links.map(async ({ circleAggregateId }) =>
          (await ctx.db
            .query("circleCopyShares")
            .withIndex("by_circle_copy", (q) =>
              q.eq("circleId", circleAggregateId).eq("copyId", copyId),
            )
            .first()) !== null
            ? circleAggregateId
            : null,
        ),
      )
    ).filter((c) => c !== null);
  }
  return (
    await Promise.all(
      candidateCircles.map(async (circleId) => {
        // The collector only sees circles listForMember resolves: a viewer junction row AND an
        // existing circles row.
        if (
          !(await isMemberOf(ctx, circleId, viewerId)) ||
          !(await isMemberOf(ctx, circleId, row.ownerId))
        ) {
          return null;
        }
        return ctx.db
          .query("circles")
          .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
          .unique();
      }),
    )
  ).filter((c) => c !== null);
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

import type { CircleId, OwnerId } from "@jigswap/domain";
import { toCopyId, toMemberId, toOwnerId } from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
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
// BOUNDED (#190): at most CIRCLE_SHARES_READ_PER_CIRCLE shares are read per circle (newest first), so a
// copy shared further back in a very busy circle can drop out of this batched set. That only affects
// the list surface built on it (Browse); every per-copy gate (canViewCopy / canViewCopyWithContext,
// the definition view) uses `isCircleSharedWithViewer` instead, which reads that copy's own shares
// (capped by_copy, with a viewer-circle fallback that reaches the same decision up to
// MAX_VIEWER_CIRCLES_READ), so this cap can't hide a copy on its detail page.
export const CIRCLE_SHARES_READ_PER_CIRCLE = 200;
export const MAX_SHARES_READ_PER_COPY = 100;
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
// at most MAX_SHARES_READ_PER_COPY shares are read by_copy. Past that, the candidate circles come from
// the VIEWER's own memberships instead (circleMembers.by_member), each probed with a
// circleCopyShares.by_circle_copy point lookup. Both routes yield the same set of qualifying circles,
// so the decision is identical to the uncapped rule (no false negatives) as long as the viewer is in
// at most MAX_VIEWER_CIRCLES_READ circles. Beyond that the fallback FAILS CLOSED (not circle-shared):
// today any circle admin can seat a member without consent, so this list is attacker-inflatable too.
// The root fix is consent-based circle invitations plus a per-member circle cap.
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

export const collectCircleSharedCopies = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
): Promise<Doc<"ownedPuzzles">[]> => {
  const circles = convexCircleRepository(ctx);
  const viewer = toMemberId(viewerId);
  const myCircles = await circles.listForMember(viewer);
  if (myCircles.length === 0) return [];

  // Resolve every copy shared into any of the viewer's circles (by CopyId aggregateId), remembering
  // which of the viewer's circles each copy was shared into.
  const sharedInto = new Map<string, CircleId[]>();
  for (const circle of myCircles) {
    const shares = await ctx.db
      .query("circleCopyShares")
      .withIndex("by_circle", (q) => q.eq("circleId", circle.id as string))
      .order("desc")
      .take(CIRCLE_SHARES_READ_PER_CIRCLE);
    for (const share of shares) {
      const into = sharedInto.get(share.copyId) ?? [];
      into.push(circle.id);
      sharedInto.set(share.copyId, into);
    }
  }
  if (sharedInto.size === 0) return [];

  // The copy repository only reads here (findById); a QueryCtx is structurally sufficient.
  const copyRepo = convexCopyRepository(ctx as unknown as MutationCtx);
  const resolved = await Promise.all(
    [...sharedInto].map(async ([copyId, into]) => {
      const row = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
        .unique();
      if (!row) return null;
      // Keep only the circles the copy's owner is still a member of (junction probe per circle).
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
      if (qualifying.length === 0) return null;
      const copy = await copyRepo.findById(toCopyId(copyId));
      return copy ? { row, copy, qualifying } : null;
    }),
  );
  const candidates = resolved.filter((r) => r !== null);
  if (candidates.length === 0) return [];

  // The policy sees, per copy, exactly the qualifying circles resolved above.
  const owner = (id: Id<"users">): OwnerId => toOwnerId(id);
  const circlesByCopy = new Map(
    candidates.map((c) => [c.copy.id as string, c.qualifying]),
  );
  const policy = makeCircleAwareVisibilityPolicy(
    (copy) => circlesByCopy.get(copy.id as string) ?? [],
  );

  return candidates
    .filter((c) => policy.canView(owner(viewerId), c.copy))
    .map((c) => c.row);
};

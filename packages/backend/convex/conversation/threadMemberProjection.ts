import type { ProjectedMember } from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { toMemberView } from "../identity/toMemberView";
import { projectMemberIdentity } from "../social/privacy";

/**
 * Whether `memberId` is CURRENTLY in the circle: the `circleMembers` junction, which the circle
 * repository keeps an exact mirror of its memberships (a leaver's row goes in the same
 * transaction). The thread's own participant set follows it through an async sync, so gates use
 * this as the authoritative check.
 */
export const isCurrentCircleMember = async (
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

/**
 * Project a member of circle `circleId` for `viewerId`, salted with `salt`. The circle rule applies
 * only while the VIEWER is a current member too (checked here, not trusted to the caller); a
 * non-member viewer gets plain projectMemberIdentity. A target who is a CURRENT member of the circle is always revealed, identity
 * only, as the circle rule (#152) does, and that holds even when the target blocked the viewer:
 * anonymising them there would tell the blocked side about the block (Q8). Everyone else, a
 * former member included, falls through to projectMemberIdentity (departed members stay "Former
 * member", and the ordinary rules may anonymise). Shared by the circle chat and getCircle, so the
 * members list and the chat always name the same people.
 */
export const projectCircleMember = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  targetId: Id<"users">,
  circleId: string,
  salt: string,
): Promise<ProjectedMember> => {
  const projected = await projectMemberIdentity(ctx, viewerId, targetId, salt);
  if (
    !projected.anonymous ||
    projected.departed ||
    !(await isCurrentCircleMember(ctx, circleId, viewerId)) ||
    !(await isCurrentCircleMember(ctx, circleId, targetId))
  ) {
    return projected;
  }
  // Only a block by the target leaves a current, active co-member anonymous above.
  const target = await ctx.db.get(targetId);
  if (!target) return projected;
  const {
    bio: _bio,
    location: _location,
    preferredLanguage: _preferredLanguage,
    ...identity
  } = toMemberView(target);
  return { anonymous: false, member: identity };
};

/**
 * Project a member who appears in a thread (an author, a join/leave subject, the inbox avatar
 * stack) for `viewerId`, salted with the thread id. In a circle thread this is
 * {@link projectCircleMember}; in any other thread, projectMemberIdentity.
 */
export const projectThreadMember = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  targetId: Id<"users">,
  thread: Doc<"threads">,
): Promise<ProjectedMember> =>
  thread.subjectKind === "circle" && thread.circleId !== undefined
    ? projectCircleMember(
        ctx,
        viewerId,
        targetId,
        thread.circleId,
        thread.aggregateId,
      )
    : projectMemberIdentity(ctx, viewerId, targetId, thread.aggregateId);

/**
 * Per-request memo of {@link projectThreadMember} for one viewer and thread: a page of messages
 * repeats a handful of authors, each projected once.
 */
export const threadMemberProjector = (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  thread: Doc<"threads">,
) => {
  const memo = new Map<Id<"users">, Promise<ProjectedMember>>();
  return (targetId: Id<"users">): Promise<ProjectedMember> => {
    let projected = memo.get(targetId);
    if (!projected) {
      projected = projectThreadMember(ctx, viewerId, targetId, thread);
      memo.set(targetId, projected);
    }
    return projected;
  };
};

import type {
  Circle,
  CircleId,
  CircleRepository,
  MemberId,
} from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { toDomain, toRow } from "./mapper";

// Driven adapter for the CircleRepository port over `ctx.db`. The only place the `circles` table
// (and its `circleMembers` lookup projection) are read/written for the domain path; the mapper is
// the ACL. Reads accept a QueryCtx so read-views reuse listForMember; writes need a MutationCtx.
export const convexCircleRepository = (
  ctx: MutationCtx | QueryCtx,
): CircleRepository => ({
  async findById(id: CircleId): Promise<Circle | null> {
    const row = await ctx.db
      .query("circles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();
    return row ? toDomain(row) : null;
  },

  // Every circle the member belongs to, via the `circleMembers` projection. Backs the circle-aware
  // VisibilityPolicy wiring (intersecting a viewer's and an owner's circles).
  async listForMember(memberId: MemberId): Promise<readonly Circle[]> {
    const links = await ctx.db
      .query("circleMembers")
      .withIndex("by_member", (q) =>
        q.eq("memberId", memberId as unknown as Id<"users">),
      )
      .collect();

    const circles = await Promise.all(
      links.map((link) =>
        ctx.db
          .query("circles")
          .withIndex("by_aggregate_id", (q) =>
            q.eq("aggregateId", link.circleAggregateId),
          )
          .unique(),
      ),
    );
    return circles.filter((row) => row !== null).map(toDomain);
  },

  // Persist the aggregate as one unit, then reconcile the `circleMembers` projection to exactly
  // mirror the embedded memberships (add new seats, drop departed ones).
  async save(circle: Circle): Promise<void> {
    const db = (ctx as MutationCtx).db;
    const row = toRow(circle);
    const existing = await ctx.db
      .query("circles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", row.aggregateId))
      .unique();
    if (existing) await db.patch(existing._id, row);
    else await db.insert("circles", row);

    const desired = new Set(
      row.memberships.map((m) => m.memberId as unknown as string),
    );
    const links = await ctx.db
      .query("circleMembers")
      .withIndex("by_circle", (q) =>
        q.eq("circleAggregateId", row.aggregateId!),
      )
      .collect();
    const present = new Set(links.map((l) => l.memberId as unknown as string));

    for (const link of links) {
      if (!desired.has(link.memberId as unknown as string)) {
        await db.delete(link._id);
      }
    }
    for (const m of row.memberships) {
      if (!present.has(m.memberId as unknown as string)) {
        await db.insert("circleMembers", {
          circleAggregateId: row.aggregateId!,
          memberId: m.memberId,
        });
      }
    }
  },
});

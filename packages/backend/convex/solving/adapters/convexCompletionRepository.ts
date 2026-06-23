import {
  type Completion,
  type CompletionId,
  type CompletionRepository,
  type CopyId,
  type MemberId,
  type PuzzleDefinitionId,
  toCopyId,
  toPuzzleDefinitionId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { toDomain, toRow } from "./completionMapper";

// Driven adapter for the CompletionRepository port over `ctx.db`. The only place the
// `completions` table is read/written for the domain path; the mapper is the ACL. The Catalog
// (`puzzleId`) and Library (`ownedPuzzleId`) references are `v.id(...)` FK columns, so they must
// hold genuine document ids — the repository resolves them from the domain's aggregateIds.
export const convexCompletionRepository = (
  ctx: MutationCtx,
): CompletionRepository => {
  const rowById = (id: CompletionId): Promise<Doc<"completions"> | null> =>
    ctx.db
      .query("completions")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();

  // Resolve the real `puzzles._id` for a Catalog PuzzleDefinitionId aggregateId; legacy puzzles
  // that predate aggregateId fall back to treating the value as a raw `_id`.
  const resolvePuzzleId = async (
    puzzleDefinitionId: PuzzleDefinitionId,
  ): Promise<Id<"puzzles">> => {
    const byAggregateId = await ctx.db
      .query("puzzles")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", puzzleDefinitionId as string),
      )
      .unique();
    return byAggregateId
      ? byAggregateId._id
      : (puzzleDefinitionId as unknown as Id<"puzzles">);
  };

  // Resolve the real `ownedPuzzles._id` for a Library CopyId aggregateId; legacy copies that
  // predate aggregateId fall back to treating the value as a raw `_id`.
  const resolveCopyId = async (copyId: CopyId): Promise<Id<"ownedPuzzles">> => {
    const byAggregateId = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", copyId as string),
      )
      .unique();
    return byAggregateId
      ? byAggregateId._id
      : (copyId as unknown as Id<"ownedPuzzles">);
  };

  // Map a stored `puzzles._id` back to its PuzzleDefinitionId aggregateId for the domain.
  const puzzleAggregateId = async (
    puzzleId: Id<"puzzles"> | undefined,
  ): Promise<PuzzleDefinitionId | undefined> => {
    if (!puzzleId) return undefined;
    const row = await ctx.db.get(puzzleId);
    return toPuzzleDefinitionId(
      (row?.aggregateId ?? (puzzleId as unknown as string)) as string,
    ) as PuzzleDefinitionId;
  };

  // Map a stored `ownedPuzzles._id` back to its CopyId aggregateId for the domain.
  const copyAggregateId = async (
    ownedPuzzleId: Id<"ownedPuzzles"> | undefined,
  ): Promise<CopyId | undefined> => {
    if (!ownedPuzzleId) return undefined;
    const row = await ctx.db.get(ownedPuzzleId);
    return toCopyId(
      (row?.aggregateId ?? (ownedPuzzleId as unknown as string)) as string,
    ) as CopyId;
  };

  const hydrate = async (row: Doc<"completions">): Promise<Completion> =>
    toDomain(
      row,
      await puzzleAggregateId(row.puzzleId),
      await copyAggregateId(row.ownedPuzzleId),
    );

  return {
    async findById(id: CompletionId): Promise<Completion | null> {
      const row = await rowById(id);
      return row ? hydrate(row) : null;
    },

    async save(completion: Completion): Promise<void> {
      const mapped = toRow(completion);
      const state = completion.toState();
      const row = {
        ...mapped,
        puzzleId: state.puzzleDefinitionId
          ? await resolvePuzzleId(state.puzzleDefinitionId)
          : undefined,
        ownedPuzzleId: state.copyId
          ? await resolveCopyId(state.copyId)
          : undefined,
      };
      const existing = await rowById(completion.id);
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("completions", row);
    },

    async listByUser(userId: MemberId): Promise<readonly Completion[]> {
      const rows = await ctx.db
        .query("completions")
        .withIndex("by_user", (q) =>
          q.eq("userId", userId as unknown as Id<"users">),
        )
        .collect();
      // Only domain-written rows (legacy rows lack an aggregateId) participate in the new path.
      const owned = rows.filter((row) => row.aggregateId !== undefined);
      return Promise.all(owned.map((row) => hydrate(row)));
    },

    async countCompletedByUser(userId: MemberId): Promise<number> {
      const rows = await ctx.db
        .query("completions")
        .withIndex("by_user", (q) =>
          q.eq("userId", userId as unknown as Id<"users">),
        )
        .collect();
      // The authoritative count of FINISHED completions; drives the derived goal progress.
      return rows.filter((row) => row.isCompleted).length;
    },

    async delete(id: CompletionId): Promise<void> {
      const row = await rowById(id);
      // No-op if the row is already gone (idempotent).
      if (row) await ctx.db.delete(row._id);
    },
  };
};

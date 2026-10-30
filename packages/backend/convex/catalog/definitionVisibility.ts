import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { optionalActingMember } from "../identity/optionalActingMember";

// Catalog moderation gate for reading a single DEFINITION by id: an approved definition is public;
// any other status (pending, rejected, disabled) is disclosed only to its submitter or an admin.
// Callers return the same answer as for an unknown id when this is false (null, or "Puzzle not
// found"), so the gate never reveals that a hidden definition exists.
//
// `actingMember` is the caller's member id when the caller already resolved it from auth
// (requireMember / optionalActingMember), never a client-supplied id. Left undefined, it is
// resolved here, and only for a non-approved definition.
export const canViewDefinition = async (
  ctx: QueryCtx,
  puzzle: Pick<Doc<"puzzles">, "status" | "submittedBy">,
  actingMember?: Id<"users"> | null,
): Promise<boolean> => {
  if (puzzle.status === "approved") return true;
  const member =
    actingMember === undefined ? await optionalActingMember(ctx) : actingMember;
  if (member !== null && puzzle.submittedBy === member) return true;
  return isAdmin(ctx);
};

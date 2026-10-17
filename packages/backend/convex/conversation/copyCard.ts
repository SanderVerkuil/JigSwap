import type { MessageCopyView } from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { canViewCopy } from "../library/canViewCopy";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";

// The compact copy card a copy-referencing conversation shows (composer header, message card).
// Snapshot first, catalogue row fallback — same precedence as the inbox's exchange subject.
export const messageCopyViewOf = async (
  ctx: QueryCtx,
  copy: Doc<"ownedPuzzles">,
): Promise<MessageCopyView> => {
  const puzzle = await ctx.db.get(copy.puzzleId);
  return {
    copyId: copy._id,
    title: copy.snapshot?.title ?? puzzle?.title ?? "",
    brand: copy.snapshot?.brand ?? puzzle?.brand ?? null,
    pieceCount: copy.snapshot?.pieceCount ?? puzzle?.pieceCount ?? null,
    coverUrl: await resolveCopyCoverUrl(ctx, copy, puzzle),
  };
};

// Per-request resolver for message copy references: the card only while `viewerId` may still
// view the copy (canViewCopy), undefined otherwise. Memoised so a thread referencing the same
// copy many times pays the gate once.
export const viewableCopyCards = (ctx: QueryCtx, viewerId: Id<"users">) => {
  const memo = new Map<
    Id<"ownedPuzzles">,
    Promise<MessageCopyView | undefined>
  >();
  return (copyId: Id<"ownedPuzzles">): Promise<MessageCopyView | undefined> => {
    let card = memo.get(copyId);
    if (!card) {
      card = (async () => {
        const copy = await ctx.db.get(copyId);
        if (!copy || !(await canViewCopy(ctx, viewerId, copy)))
          return undefined;
        return messageCopyViewOf(ctx, copy);
      })();
      memo.set(copyId, card);
    }
    return card;
  };
};

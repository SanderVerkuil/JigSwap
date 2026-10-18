import type { MessageCopyView } from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  buildCopyViewContext,
  canViewCopy,
  canViewCopyWithContext,
  type CopyViewContext,
} from "../library/canViewCopy";
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

// A viewable context copy before it is labelled for a thread: the card plus its owner, which the
// caller maps to "viewer" / "other" against the thread's participants.
export interface ViewableContextCopy {
  readonly card: MessageCopyView;
  readonly ownerId: Id<"users">;
}

// Per-request resolver for an inbox thread's context copies: the card only while `viewerId` may
// view the copy, null otherwise (including a deleted copy). Memoised per copy (gate AND cover
// URL), and the viewer's copy-view context (circle shares, household) is built lazily at most
// once — the inbox resolves many threads, so per-copy canViewCopy would rebuild it per thread.
export const viewableContextCopies = (ctx: QueryCtx, viewerId: Id<"users">) => {
  let context: Promise<CopyViewContext> | undefined;
  const memo = new Map<
    Id<"ownedPuzzles">,
    Promise<ViewableContextCopy | null>
  >();
  return (copyId: Id<"ownedPuzzles">): Promise<ViewableContextCopy | null> => {
    let resolved = memo.get(copyId);
    if (!resolved) {
      resolved = (async () => {
        const copy = await ctx.db.get(copyId);
        if (!copy) return null;
        context ??= buildCopyViewContext(ctx, viewerId);
        if (!(await canViewCopyWithContext(ctx, copy, await context)))
          return null;
        return {
          card: await messageCopyViewOf(ctx, copy),
          ownerId: copy.ownerId,
        };
      })();
      memo.set(copyId, resolved);
    }
    return resolved;
  };
};

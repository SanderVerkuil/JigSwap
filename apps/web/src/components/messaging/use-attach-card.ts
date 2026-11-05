"use client";

import { gateway, type Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";

// The puzzle a copy's "Message" brought along (the thread route's ?attach), if it belongs in this
// thread. getCopyConversation applies the same gates as the copy's page and says which DM the copy
// belongs to, so a hand-typed ?attach= for someone else's copy gives no card. The composer stages
// the card, and the thread view decides from it who takes focus; both share this one read.
export function useAttachCard(
  attachCopyId: string | undefined,
  threadId: string,
) {
  const { data, isPending } = useQuery(
    convexQuery(
      gateway.conversation.getCopyConversation,
      attachCopyId ? { copyId: attachCopyId as Id<"ownedPuzzles"> } : "skip",
    ),
  );
  return {
    card:
      data?.status === "existing" && data.threadId === threadId
        ? data.copy
        : undefined,
    // A failed read (a malformed id) has settled too: without a card.
    pending: attachCopyId !== undefined && isPending,
  };
}

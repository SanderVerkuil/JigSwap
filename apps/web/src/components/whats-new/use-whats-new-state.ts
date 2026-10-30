"use client";

import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { WHATS_NEW_MANIFEST } from "@jigswap/contracts";
import { useQuery } from "@tanstack/react-query";
import { knownUnreadIds } from "./logic";

// Ids from the committed manifest, not `./entries`: this hook runs on every dashboard page (badges,
// announcer, tours), and the entry bodies are only needed by /whats-new and the highlight modal.
// The build fails if the manifest and docs/whats-new disagree (vite-plugin-whats-new.ts).
const WHATS_NEW_IDS: ReadonlySet<string> = new Set(
  WHATS_NEW_MANIFEST.map((entry) => entry.id),
);

// The member's What's new state, shared by the page, the badges, the live region and the modal
// (Convex dedupes the one subscription). `unreadIds` is undefined while loading — callers treat
// that as "nothing unread" so no badge or pill flashes in during SSR — and only holds ids this
// bundle can render.
export function useWhatsNewState() {
  const { member } = useCurrentMember();
  const { data } = useQuery(
    convexQuery(gateway.whatsNew.state, member?._id ? {} : "skip"),
  );
  const unreadIds = data
    ? knownUnreadIds(data.unreadIds, WHATS_NEW_IDS)
    : undefined;
  return { unreadIds, tours: data?.tours };
}

/** Unread count for the badges: 0 while loading. */
export function useWhatsNewUnreadCount(): number {
  return useWhatsNewState().unreadIds?.length ?? 0;
}

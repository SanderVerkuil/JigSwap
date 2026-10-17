"use client";

import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { WHATS_NEW_IDS } from "./entries";
import { knownUnreadIds } from "./logic";

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

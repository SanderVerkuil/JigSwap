"use client";

// The live counts the phone chrome shows, so Messages and waiting requests are visible without
// opening the Community hub: unread messages (the top-bar Messages icon, the Community tab dot, the
// quick-sheet and hub rows) and incoming exchange requests still waiting for the member's answer
// (the Swaps tab badge and the Exchanges hub row). Both reads need a member, so they skip until it
// is known; Convex dedupes the shared subscriptions (the desktop sidebar reads the same total).
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";

export function useUnreadMessageCount(): number {
  const { member } = useCurrentMember();
  const { data } = useQuery(
    convexQuery(gateway.conversation.getUnreadTotal, member?._id ? {} : "skip"),
  );
  return data ?? 0;
}

// The same definition the dashboard's pending banner uses: requests the member received (owner
// side) that are still proposed.
export function usePendingRequestCount(): number {
  const { member } = useCurrentMember();
  const { data } = useQuery(
    convexQuery(gateway.exchange.forUser, member?._id ? {} : "skip"),
  );
  return (data ?? []).filter(
    (exchange) =>
      exchange.userRole === "owner" && exchange.status === "proposed",
  ).length;
}

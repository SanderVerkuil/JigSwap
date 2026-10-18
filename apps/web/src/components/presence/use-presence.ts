"use client";

// Presence reads for the web (spec 4.2, 5.1): the viewer's own settings and, per surface, one
// batched getPresenceOf subscription. Visibility is decided server-side (opt-in, mutual-only,
// reciprocal); offline and hidden members are simply absent, so "no status" renders nothing.
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { gateway, type Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import type { PresenceSettingsView, PresenceView } from "@jigswap/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export type PresenceStatus = PresenceView["status"];

/** The most members one getPresenceOf call may ask about (the backend's cap). */
export const MAX_PRESENCE_TARGETS = 50;

/** The viewer's own presence settings; undefined while loading (or when the read fails). */
export function usePresenceSettings(): PresenceSettingsView | undefined {
  // Gated on the Convex member (Convex dedupes the subscription across surfaces).
  const { member } = useCurrentMember();
  const { data } = useQuery(
    convexQuery(gateway.social.presenceSettings, member ? {} : "skip"),
  );
  return data;
}

/**
 * Which of these members the viewer may see online or away, as one subscription. Ids are
 * de-duplicated and capped at the first {@link MAX_PRESENCE_TARGETS} (callers pass them most
 * relevant first), then sorted so reordering a list doesn't resubscribe. Skipped entirely while
 * the viewer doesn't share (reciprocity: the backend would return nothing anyway).
 */
export function usePresenceOf(
  memberIds: readonly (string | null | undefined)[],
): ReadonlyMap<string, PresenceStatus> {
  const settings = usePresenceSettings();
  const key = [...new Set(memberIds.filter((id): id is string => Boolean(id)))]
    .slice(0, MAX_PRESENCE_TARGETS)
    .sort()
    .join(",");
  const enabled = settings?.share === true && key !== "";
  const { data } = useQuery(
    convexQuery(
      gateway.social.presenceOf,
      enabled ? { memberIds: key.split(",") as Id<"users">[] } : "skip",
    ),
  );
  return useMemo(
    () => new Map((data ?? []).map((view) => [view.memberId, view.status])),
    [data],
  );
}

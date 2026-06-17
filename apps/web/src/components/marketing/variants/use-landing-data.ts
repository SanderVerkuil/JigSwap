import { gateway } from "@/gateway";
import { useQuery } from "convex/react";
import * as React from "react";

// Shared marketing data hook so every landing variant pulls the same real
// platform numbers without re-implementing the Convex wiring. Mirrors the
// query usage in the original hero/stats components.
//
// SSR-safe: the seed-dependent queries are skipped until a client-side seed is
// generated after mount, so the server render is deterministic.

export type LandingStats = {
  totalUsers: number;
  totalPuzzles: number;
  totalOwnedPuzzles: number;
};

export type CommunityAvatar = { initials: string; image: string | null };

export type PlankPuzzle = {
  title: string;
  pieceCount: number;
  brand?: string;
  image: string | null;
};

export type LandingData = {
  /** Global platform counters; `undefined` while loading. */
  stats: LandingStats | undefined;
  /** Up to `avatarLimit` real community members; `undefined` while loading. */
  communityAvatars: CommunityAvatar[] | undefined;
  /** Up to `plankLimit` recent catalog puzzles for shelf/plank visuals. */
  plankPuzzles: PlankPuzzle[] | undefined;
};

export function useLandingData(options?: {
  avatarLimit?: number;
  plankLimit?: number;
}): LandingData {
  const avatarLimit = options?.avatarLimit ?? 4;
  const plankLimit = options?.plankLimit ?? 12;

  const stats = useQuery(gateway.insights.globalStats, {}) as
    | LandingStats
    | undefined;

  // Stable per-visit seed generated client-side after mount (SSR-safe). The
  // seeded queries stay skipped until it is ready.
  const [seed, setSeed] = React.useState<number | null>(null);
  React.useEffect(() => setSeed(Math.floor(Math.random() * 0xffffffff)), []);

  const communityAvatars = useQuery(
    gateway.insights.communityAvatars,
    seed === null ? "skip" : { limit: avatarLimit, seed },
  ) as CommunityAvatar[] | undefined;

  const plankPuzzles = useQuery(
    gateway.insights.plankPuzzles,
    seed === null ? "skip" : { limit: plankLimit, seed },
  ) as PlankPuzzle[] | undefined;

  return { stats, communityAvatars, plankPuzzles };
}

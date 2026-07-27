// IMPORTANT: apps/web does NOT depend on @jigswap/contracts — the repo convention is "the web
// tier derives Convex view types from the gateway" (see profile-body.tsx:48). Deriving via
// FunctionReturnType keeps that rule AND keeps the bidirectional exhaustiveness check.
import type { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";
import type { LucideIcon } from "lucide-react";
import { ArrowRightLeft, CircleCheck, Package, Puzzle } from "lucide-react";

type FeedEntryKind = FunctionReturnType<
  typeof gateway.social.activityFeed
>[number]["kind"];

// Every activity kind the web app knows how to render. The type-level assertions below force this
// list to stay in sync with the server union in BOTH directions — adding a kind server-side
// without touching this file is a compile error, and vice versa.
export const ACTIVITY_KINDS = [
  "completion",
  "acquisition",
  "exchange",
  "started",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

// Bidirectional exhaustiveness check against the gateway-derived union.
type _ContractCoversLocal = FeedEntryKind extends ActivityKind ? true : never;
type _LocalCoversContract = ActivityKind extends FeedEntryKind ? true : never;
const _exhaustive: [_ContractCoversLocal, _LocalCoversContract] = [true, true];
void _exhaustive;

// Icon + accent per kind; labels are translated at render time (activity.<kind>.*).
export const ACTIVITY_META: Record<
  ActivityKind,
  { icon: LucideIcon; accent: string }
> = {
  completion: { icon: CircleCheck, accent: "text-green-500" },
  acquisition: { icon: Package, accent: "text-blue-500" },
  exchange: { icon: ArrowRightLeft, accent: "text-amber-500" },
  started: { icon: Puzzle, accent: "text-sky-500" },
};

// Deploy-order safety: Convex deploys before web bundles, so an already-open client can receive a
// kind this bundle doesn't know. Renderers MUST skip unknown kinds instead of crashing.
export const isKnownActivityKind = (kind: string): kind is ActivityKind =>
  (ACTIVITY_KINDS as readonly string[]).includes(kind);

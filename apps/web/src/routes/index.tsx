import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as React from "react";

import { pageTitle } from "@/lib/page-title";

import { Landing } from "@/components/marketing/variants/landing";
import {
  DEFAULT_VARIANT,
  isVariantId,
  type VariantId,
} from "@/components/marketing/variants/registry";

// Persisted variant choice, so a reviewer's pick survives reloads even without
// the `?v=` param in the URL.
const STORAGE_KEY = "jigswap.landing.variant";

type HomeSearch = { v?: VariantId };

export const Route = createFileRoute("/")({
  // Keep `?v=` as a known, validated search param (anything else is dropped) so
  // the active landing variant is SSR-safe and shareable as a preview URL.
  validateSearch: (search: Record<string, unknown>): HomeSearch =>
    isVariantId(search.v) ? { v: search.v } : {},
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "home") }],
  }),
  component: Home,
});

// Marketing landing. Ships several drastically different design variants behind
// a floating switcher (review-only) so the team can compare them live and keep
// the winner. The URL `?v=` param wins; otherwise we fall back to the reviewer's
// last stored choice, then the default variant.
function Home() {
  const navigate = useNavigate();
  const { v } = Route.useSearch();

  // Client-only stored fallback, read after mount so the first (SSR-matching)
  // render stays deterministic and never mismatches hydration.
  const [stored, setStored] = React.useState<VariantId | null>(null);
  React.useEffect(() => {
    if (v) return;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isVariantId(saved)) setStored(saved);
    } catch {
      /* localStorage unavailable — fall through to the default */
    }
  }, [v]);

  const variant: VariantId = v ?? stored ?? DEFAULT_VARIANT;

  const onVariantChange = React.useCallback(
    (id: VariantId) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, id);
      } catch {
        /* ignore — URL param still drives the selection */
      }
      setStored(id);
      navigate({ to: "/", search: { v: id }, replace: true });
    },
    [navigate],
  );

  return <Landing variant={variant} onVariantChange={onVariantChange} />;
}

// Localized document titles for route head() functions. head() runs outside
// React, so useTranslations isn't available. The reliable source is the
// head context's `match.context`: head executes after the load phase, and the
// router rebuilds the match's merged context (including the root beforeLoad's
// intl payload) when the match loads. Note that head's `matches` array and
// `loaderData` are NOT reliable for this — they can be stale/pre-load
// snapshots — so always pass `match.context` here. The context carries only
// the locale; the strings come from that locale's catalog, which the root
// beforeLoad (and hydration) loaded before any head runs.

import { contextLocale } from "@/lib/i18n";
import { messagesFor } from "@/lib/i18n-catalog";

const FALLBACK = "JigSwap";

export function pageTitle(context: unknown, key: string): string {
  const locale = contextLocale(context);
  const messages = locale ? messagesFor(locale) : undefined;
  const titles = messages?.titles as Record<string, string> | undefined;
  const marketing = messages?.marketing as
    { titles?: Record<string, string> } | undefined;
  return titles?.[key] ?? marketing?.titles?.[key] ?? FALLBACK;
}

// The root route's title, for pages that don't set their own: the brand, or the
// not-found title when the router has no route for the URL. `_notFound` marks the
// match whose layout renders the 404 (the root or a nearer one, like _public); it
// is underscored but typed, so a router upgrade that renames it fails type-check.
export function defaultDocumentTitle(
  context: unknown,
  matches: ReadonlyArray<{ _notFound?: boolean }>,
): string {
  return matches.some((match) => match._notFound)
    ? pageTitle(context, "notFound")
    : FALLBACK;
}

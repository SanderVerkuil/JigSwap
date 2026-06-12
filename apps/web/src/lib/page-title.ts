// Localized document titles for route head() functions. head() runs outside
// React, so useTranslations isn't available. The reliable source is the
// head context's `match.context`: head executes after the load phase, and the
// router rebuilds the match's merged context (including the root beforeLoad's
// intl payload) when the match loads. Note that head's `matches` array and
// `loaderData` are NOT reliable for this — they can be stale/pre-load
// snapshots — so always pass `match.context` here.

import type { IntlPayload } from "@/lib/i18n";

const FALLBACK = "JigSwap";

export function pageTitle(context: unknown, key: string): string {
  const intl = (context as { intl?: IntlPayload } | undefined)?.intl;
  const titles = intl?.messages?.titles as Record<string, string> | undefined;
  const marketing = intl?.messages?.marketing as
    | { titles?: Record<string, string> }
    | undefined;
  return titles?.[key] ?? marketing?.titles?.[key] ?? FALLBACK;
}

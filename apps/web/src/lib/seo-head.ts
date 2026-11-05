// Search and share metadata for public route head() functions: a localized <title> and
// description plus the Open Graph / Twitter tags that link previews (WhatsApp, iMessage, social
// sites) read. Like pageTitle, the strings come from the catalog of the locale the root beforeLoad
// puts in the head context's `match.context`.

import type { IntlPayload } from "@/lib/i18n";
import { messagesFor } from "@/lib/i18n-catalog";
import { pageTitle } from "@/lib/page-title";
import { createTranslator } from "use-intl/core";

const SITE_NAME = "JigSwap";
const OG_LOCALES: Record<string, string> = { en: "en_US", nl: "nl_NL" };
// The square brand mark (apps/web/public), which suits a `summary` card. Scrapers need an absolute
// URL, so it's only offered once the site origin is known.
const SHARE_IMAGE_PATH = "/icon-512.png";

type HeadMatch = { context: unknown; pathname: string };
type MessageValues = Record<string, string | number>;

export type SeoOverrides = {
  title?: string;
  description?: string;
  /** Absolute image URL, e.g. a catalogue cover. */
  image?: string;
};

function intlOf(context: unknown): IntlPayload | undefined {
  return (context as { intl?: IntlPayload } | undefined)?.intl;
}

// The production origin, baked in at build time (vite.config.ts) from Vercel's
// VERCEL_PROJECT_PRODUCTION_URL. Unset locally and in CI, where og:url and og:image are omitted
// rather than guessed: the repo hard-codes no domain.
function siteOrigin(): string | undefined {
  const origin = import.meta.env.VITE_SITE_ORIGIN as string | undefined;
  return origin || undefined;
}

// A message from the visitor's catalog, ICU-formatted; undefined when the key is missing (or the
// context carries no intl payload, or its catalog isn't loaded) so the caller can fall back.
export function headMessage(
  context: unknown,
  key: string,
  values?: MessageValues,
): string | undefined {
  const intl = intlOf(context);
  const messages = intl ? messagesFor(intl.locale) : undefined;
  if (!intl || !messages) return undefined;
  const t = createTranslator({
    locale: intl.locale,
    // The catalog is only known at runtime; widen it so any dotted key type-checks.
    messages: messages as Record<string, string>,
    timeZone: intl.timeZone,
  });
  return t.has(key) ? t(key, values) : undefined;
}

// Head tags for a public page. `key` names its title (marketing.titles.<key>, via pageTitle) and
// description (marketing.meta.<key>); a missing title falls back to "JigSwap" and a missing
// description is left out. Routes with their own content (catalogue entries, docs pages) pass
// overrides.
export function seoHead(
  match: HeadMatch,
  key: string,
  overrides: SeoOverrides = {},
) {
  const intl = intlOf(match.context);
  const title = overrides.title ?? pageTitle(match.context, key);
  const description =
    overrides.description ??
    headMessage(match.context, `marketing.meta.${key}`);
  const origin = siteOrigin();
  const image =
    overrides.image ?? (origin ? `${origin}${SHARE_IMAGE_PATH}` : undefined);
  const ogLocale = OG_LOCALES[intl?.locale ?? ""];

  return {
    meta: [
      { title },
      ...(description
        ? [
            { name: "description", content: description },
            { property: "og:description", content: description },
          ]
        : []),
      { property: "og:title", content: title },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      ...(ogLocale ? [{ property: "og:locale", content: ogLocale }] : []),
      ...(origin
        ? [{ property: "og:url", content: `${origin}${match.pathname}` }]
        : []),
      ...(image ? [{ property: "og:image", content: image }] : []),
      { name: "twitter:card", content: "summary" },
    ],
  };
}

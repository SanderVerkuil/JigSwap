"use client";

import { useEffect, useState } from "react";

// Resolve a stored emoji glyph to its LOCALIZED name. frimousse (the emoji picker) exposes no
// reverse char->label lookup, so for a persisted icon (e.g. an existing collection's icon) we load
// the same emojibase data frimousse uses — it's the public emojibase CDN and the browser caches it,
// so this rides on the request the picker already makes. Parsed maps are cached per locale for the
// session. Emoji chars come from emojibase originally, so they match exactly.

type EmojiRow = { emoji: string; label: string };

const labelCache = new Map<string, Map<string, string>>();
const inflight = new Map<string, Promise<Map<string, string>>>();

function loadEmojiLabels(locale: string): Promise<Map<string, string>> {
  const cached = labelCache.get(locale);
  if (cached) return Promise.resolve(cached);

  let pending = inflight.get(locale);
  if (!pending) {
    pending = fetch(
      `https://cdn.jsdelivr.net/npm/emojibase-data@latest/${locale}/data.json`,
    )
      .then((res) => res.json() as Promise<EmojiRow[]>)
      .then((rows) => {
        const map = new Map<string, string>();
        for (const row of rows) map.set(row.emoji, row.label);
        labelCache.set(locale, map);
        inflight.delete(locale);
        return map;
      });
    inflight.set(locale, pending);
  }
  return pending;
}

// Returns the localized name for `emoji` in `locale`, or null while loading / when unknown.
export function useEmojiLabel(
  emoji: string | undefined,
  locale: string,
): string | null {
  // Keyed by the emoji it resolved for, so a stale async result for a previous glyph is ignored
  // without a synchronous setState in the effect body.
  const [resolved, setResolved] = useState<{
    emoji: string;
    label: string | null;
  } | null>(null);

  useEffect(() => {
    if (!emoji) return;
    let active = true;
    loadEmojiLabels(locale)
      .then((map) => {
        if (active) setResolved({ emoji, label: map.get(emoji) ?? null });
      })
      .catch(() => {
        /* offline / unsupported locale: fall back to showing just the glyph */
      });
    return () => {
      active = false;
    };
  }, [emoji, locale]);

  return resolved && resolved.emoji === emoji ? resolved.label : null;
}

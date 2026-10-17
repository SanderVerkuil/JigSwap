// What's new read rule. An entry is unread for a member when it was published after their account
// was created (older entries count as read: they appear in the list but never as "new") and the
// member has not seen it yet. The seen set holds entry ids; `publishedAt`/`memberCreatedAt` are
// epoch ms.

export interface WhatsNewEntryRef {
  readonly id: string;
  readonly publishedAt: number;
}

export interface WhatsNewReader {
  readonly memberCreatedAt: number;
  readonly seenIds: Iterable<string>;
}

// Ids of the unread entries, in the order given (the manifest is newest first).
export const unreadWhatsNewEntryIds = (
  entries: readonly WhatsNewEntryRef[],
  reader: WhatsNewReader,
): string[] => {
  const seen = new Set(reader.seenIds);
  return entries
    .filter(
      (entry) =>
        entry.publishedAt > reader.memberCreatedAt && !seen.has(entry.id),
    )
    .map((entry) => entry.id);
};

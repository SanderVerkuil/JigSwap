// Client-side matching for SuggestInput: the suggestion pools are small distinct-value lists
// fetched once per form, so a case-insensitive substring filter is enough — no server search.
// The exact current value is excluded (suggesting what's already typed helps nobody).
export const filterSuggestions = (
  suggestions: readonly string[],
  value: string,
): string[] => {
  const query = value.trim().toLowerCase();
  return suggestions.filter((s) => {
    const lower = s.toLowerCase();
    if (lower === query) return false;
    return query.length === 0 || lower.includes(query);
  });
};

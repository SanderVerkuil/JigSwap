import * as React from "react";

// Lets a docs page open the search dialog that DocsLayout owns (it also owns
// ⌘K). Null outside the docs layout.
const DocsSearchContext = React.createContext<(() => void) | null>(null);

export const DocsSearchProvider = DocsSearchContext.Provider;

export function useOpenDocsSearch() {
  return React.useContext(DocsSearchContext);
}

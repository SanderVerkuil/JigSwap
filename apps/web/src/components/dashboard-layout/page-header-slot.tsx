"use client";

// Lets a page publish contextual content into the shell page head: its primary
// action(s) (the count/meta line + buttons) and, for dynamic routes, a title
// override (e.g. a collection's name). The same content is rendered in two
// CSS-exclusive places — the desktop page head (title + actions) and a slim
// mobile actions row — so a page registers once and never renders its own
// duplicate header.
//
// When a page publishes a `title`, the page head treats the route's own static
// title as a middle breadcrumb (linking to the route's base page) and shows the
// published title as the current leaf — e.g. My Library › Collections › Test.

import {
  createContext,
  type DependencyList,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

export type PageHeaderCrumb = { label: ReactNode; href?: string };

export type PageHeaderContent = {
  /** Overrides the route's static page title (for dynamic routes). */
  title?: ReactNode;
  /**
   * Explicit breadcrumb parent trail (excluding the current leaf, which is the
   * title). When set, the page head renders these crumbs instead of the
   * auto-derived Group › Page trail — use for deep routes like a collection's
   * add-puzzles page (My Library › Collections › <name> › Add Puzzles).
   */
  crumbs?: PageHeaderCrumb[];
  /** Meta + primary action node shown to the right of the title. */
  actions?: ReactNode;
};

type PageHeaderSlot = {
  content: PageHeaderContent;
  setContent: (content: PageHeaderContent) => void;
};

const PageHeaderSlotContext = createContext<PageHeaderSlot | null>(null);

export function PageHeaderSlotProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<PageHeaderContent>({});
  return (
    <PageHeaderSlotContext.Provider value={{ content, setContent }}>
      {children}
    </PageHeaderSlotContext.Provider>
  );
}

/**
 * Publish header actions for the current page. `render` returns the node (meta
 * text, buttons…); `deps` work exactly like useEffect deps — include any value
 * the node displays or closes over. Cleared on unmount.
 */
export function usePageHeaderActions(
  render: () => ReactNode,
  deps: DependencyList,
) {
  const slot = useContext(PageHeaderSlotContext);
  useEffect(() => {
    slot?.setContent({ actions: render() });
    return () => slot?.setContent({});
    // render is intentionally excluded; callers declare their own deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Publish a full header config (title override + actions) for the current page.
 * `factory` returns the config; `deps` work like useEffect deps. Cleared on
 * unmount. Use for dynamic routes that need a runtime title (and crumb).
 */
export function usePageHeader(
  factory: () => PageHeaderContent,
  deps: DependencyList,
) {
  const slot = useContext(PageHeaderSlotContext);
  useEffect(() => {
    slot?.setContent(factory());
    return () => slot?.setContent({});
    // factory is intentionally excluded; callers declare their own deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function usePageHeaderContent(): PageHeaderContent {
  return useContext(PageHeaderSlotContext)?.content ?? {};
}

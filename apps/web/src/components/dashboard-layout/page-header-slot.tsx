"use client";

// Lets a page publish contextual content into the shell page head: its primary
// action(s), a short meta line (a count or status) and, for dynamic routes, a
// title override (e.g. a collection's name). The actions render in two
// CSS-exclusive places — the desktop page head (title + actions) and a slim
// mobile actions row — so a page registers once and never renders its own
// duplicate header. The meta line is the shell's to place: it sits at a fixed
// spot in the desktop head, on wide screens only, and never on phones.
//
// When a page publishes a `title`, the page head treats the route's own static
// title as a middle breadcrumb (linking to the route's base page) and shows the
// published title as the current leaf — e.g. My Library › Collections › Test.
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type DependencyList,
  type ReactNode,
} from "react";

export type PageHeaderCrumb = { label: ReactNode; href?: string };

export type PageHeaderContent = {
  /** Overrides the route's static page title (for dynamic routes). */
  title?: ReactNode;
  /**
   * The page renders `title` as its own visible h1 (e.g. a puzzle's hero). The
   * desktop head then keeps the title only as the breadcrumb leaf, and the
   * mobile top bar shows it as plain text, so the page has a single title
   * heading at every width.
   */
  titleInContent?: boolean;
  /**
   * The page renders its own visible h1 (a detail page's hero title). The shell then prints its
   * title as plain text instead of a heading, so the page keeps exactly one h1. "phone": that h1
   * only shows below md, so the page head keeps its h1 from md. Set it only while that h1 is
   * actually rendered.
   */
  ownsHeading?: boolean | "phone";
  /**
   * What the mobile top bar prints instead of `title`, for a page whose hero shows the title right
   * under the bar: name where this page sits (e.g. "My Puzzles"), not the same words twice.
   */
  mobileTitle?: ReactNode;
  /**
   * Explicit breadcrumb parent trail (excluding the current leaf, which is the
   * title). When set, the page head renders these crumbs instead of the
   * auto-derived Group › Page trail — use for deep routes like a collection's
   * add-puzzles page (My Library › Collections › <name> › Add Puzzles).
   */
  crumbs?: PageHeaderCrumb[];
  /** Primary action node(s) (buttons, links) shown to the right of the title. */
  actions?: ReactNode;
  /**
   * Short page meta (e.g. "2 unread notifications"), plain text. The shell
   * renders it first in the head's action cluster on wide screens only; it is
   * supplementary, so it never competes with the actions for room.
   */
  meta?: ReactNode;
  /** Overrides the sidebar's pathname-based highlight with this nav item key. */
  activeNavKey?: string;
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
 * Publish a full header config (title override, meta, actions…) for the current page.
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

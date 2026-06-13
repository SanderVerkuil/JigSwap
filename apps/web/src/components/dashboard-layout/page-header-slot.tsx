"use client";

// Lets a page publish its contextual header content — the count/meta line and
// the primary action (e.g. "0 active" + "New Goal") — up into the shell page
// head, so a page no longer renders its own duplicate title/section header.
//
// The same registered node is rendered in two CSS-exclusive places: the
// desktop page head (right of the title) and a slim row at the top of the
// mobile content area (the mobile top bar is too slim to carry it). A page
// registers once via usePageHeaderActions; both sites read the same node.

import {
  createContext,
  type DependencyList,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

type PageHeaderSlot = {
  node: ReactNode;
  setNode: (node: ReactNode) => void;
};

const PageHeaderSlotContext = createContext<PageHeaderSlot | null>(null);

export function PageHeaderSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  return (
    <PageHeaderSlotContext.Provider value={{ node, setNode }}>
      {children}
    </PageHeaderSlotContext.Provider>
  );
}

/**
 * Publish header actions for the current page. `render` returns the node
 * (meta text, buttons…); `deps` work exactly like useEffect deps — include any
 * value the node displays or closes over (counts, dialog setters) so it stays
 * fresh. The slot is cleared on unmount so sibling pages start empty.
 */
export function usePageHeaderActions(
  render: () => ReactNode,
  deps: DependencyList,
) {
  const slot = useContext(PageHeaderSlotContext);
  useEffect(() => {
    slot?.setNode(render());
    return () => slot?.setNode(null);
    // render is intentionally excluded; callers declare their own deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function usePageHeaderSlot(): ReactNode {
  return useContext(PageHeaderSlotContext)?.node ?? null;
}

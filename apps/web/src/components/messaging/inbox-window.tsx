"use client";

// How many conversations the inbox list shows. getMyInbox returns the newest
// `limit` threads (30 without one, at most 100: the backend clamps), so the
// list starts at a page and "Show older conversations" grows it. The /messages
// layout holds the window, so it survives moving between the inbox and a
// thread (each route mounts its own ThreadList).
import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

export const INBOX_PAGE_SIZE = 30;
export const INBOX_MAX_SIZE = 100;

type InboxWindow = [number, Dispatch<SetStateAction<number>>];

const InboxWindowContext = createContext<InboxWindow | null>(null);

export function InboxWindowProvider({ children }: { children: ReactNode }) {
  const state = useState(INBOX_PAGE_SIZE);
  return (
    <InboxWindowContext.Provider value={state}>
      {children}
    </InboxWindowContext.Provider>
  );
}

// The shared window, or a list-local one outside the /messages layout.
export function useInboxWindow(): InboxWindow {
  const shared = useContext(InboxWindowContext);
  const local = useState(INBOX_PAGE_SIZE);
  return shared ?? local;
}

// getMyInbox's args for a window: the first page asks with none, so it shares
// one subscription with the other default-window readers (the toast watcher,
// the inbox guide).
export const inboxArgs = (limit: number): { limit?: number } =>
  limit === INBOX_PAGE_SIZE ? {} : { limit };

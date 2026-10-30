// Shared geometry for the /messages routes (message-center redesign spec §2):
// one two-pane surface on desktop that fills the content card edge to edge.

// Desktop list + thread panes: no frame of their own; they fill the shell's
// full-bleed content area (isFullBleedRoute) and scroll inside themselves.
// 480px is a floor for short windows; `md:h-auto` undoes the immersive h-dvh.
// From md the frame is the `messages` container that decides the split below
// (a container query can't target its own element, so only its descendants
// use the `/messages` variants). Below md there is no container, so those
// variants never match and phones never split.
export const MESSAGES_FRAME_CLASS =
  "md:@container/messages md:flex md:h-auto md:min-h-[480px] md:flex-1 md:overflow-hidden";

// Immersive thread page below md: cancel the shell's content padding and take
// the full dynamic viewport (shrinks with the keyboard, so the composer stays
// glued above it). Desktop falls back to the frame.
export const MESSAGES_IMMERSIVE_CLASS =
  "-mx-4 -mt-[18px] -mb-6 flex h-dvh flex-col md:m-0 md:flex-row";

// The list sits beside the thread (or the inbox guide) only once the frame
// itself is 48rem wide: 340px of list plus a thread of at least ~428px. The
// viewport can't decide this — an expanded sidebar takes 16rem of an 820px
// tablet and left the thread ~210px wide (UX-02). Below that the routes show
// one pane: the list on /messages, the thread (with a back link) elsewhere.
// Literal strings so Tailwind sees every class.
export const SPLIT_ONLY_CLASS = "hidden @min-[48rem]/messages:flex";
export const NO_SPLIT_ONLY_CLASS = "@min-[48rem]/messages:hidden";

// The list pane beside the thread; hidden while there's no split.
export const LIST_PANE_CLASS =
  "hidden w-[340px] shrink-0 flex-col border-r @min-[48rem]/messages:flex xl:w-[360px]";

// The inbox's list: the whole frame without a split, the same column as
// LIST_PANE_CLASS beside the guide. Container variants sort after viewport
// ones, so the xl width has to sit under the split variant to beat 340px.
export const INBOX_LIST_PANE_CLASS =
  "flex min-w-0 flex-1 flex-col @min-[48rem]/messages:w-[340px] @min-[48rem]/messages:flex-none @min-[48rem]/messages:border-r @min-[48rem]/messages:xl:w-[360px]";

// Shared geometry for the /messages routes (message-center redesign spec §2):
// one two-pane surface on desktop that fills the content card edge to edge.

// Desktop list + thread panes: no frame of their own; they fill the shell's
// full-bleed content area (isFullBleedRoute) and scroll inside themselves.
// 480px is a floor for short windows; `md:h-auto` undoes the immersive h-dvh.
export const MESSAGES_FRAME_CLASS =
  "md:flex md:h-auto md:min-h-[480px] md:flex-1 md:overflow-hidden";

// Immersive thread page below md: cancel the shell's content padding and take
// the full dynamic viewport (shrinks with the keyboard, so the composer stays
// glued above it). Desktop falls back to the frame.
export const MESSAGES_IMMERSIVE_CLASS =
  "-mx-4 -mt-[18px] -mb-6 flex h-dvh flex-col md:m-0 md:flex-row";

// Desktop list pane beside the thread.
export const LIST_PANE_CLASS =
  "hidden w-[340px] shrink-0 flex-col border-r md:flex xl:w-[360px]";

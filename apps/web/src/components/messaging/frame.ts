// Shared geometry for the /messages routes (message-center redesign spec §2):
// one framed two-pane surface on desktop whose pane headers share a rule.

// Desktop frame around list + thread panes, sized to the content card.
export const MESSAGES_FRAME_CLASS =
  "md:flex md:h-[calc(100svh-12.25rem)] md:min-h-[480px] md:overflow-hidden md:rounded-xl md:border md:bg-card";

// Immersive thread page below md: cancel the shell's content padding and take
// the full dynamic viewport (shrinks with the keyboard, so the composer stays
// glued above it). Desktop falls back to the frame.
export const MESSAGES_IMMERSIVE_CLASS =
  "-mx-4 -mt-[18px] -mb-6 flex h-dvh flex-col md:m-0 md:flex-row";

// Desktop list pane beside the thread.
export const LIST_PANE_CLASS =
  "hidden w-[340px] shrink-0 flex-col border-r md:flex xl:w-[360px]";

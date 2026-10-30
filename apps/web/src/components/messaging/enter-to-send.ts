// When Enter sends a message from a composer, and when it is left to insert a
// line break. Soft keyboards have no Shift+Enter, so on a touch screen Enter
// is a new line and the Send button sends (Ctrl/Cmd+Enter still sends, for a
// tablet's hardware keyboard). With a mouse or trackpad Enter sends and
// Shift+Enter is the new line. Never while an IME composition is open: that
// Enter picks the candidate (Safari reports it only as keyCode 229).

/** The parts of a native KeyboardEvent this needs (React's lacks isComposing). */
export type EnterKeyEvent = Pick<
  KeyboardEvent,
  | "key"
  | "shiftKey"
  | "altKey"
  | "ctrlKey"
  | "metaKey"
  | "isComposing"
  | "keyCode"
>;

export function shouldSendOnEnter(
  event: EnterKeyEvent,
  coarsePointer: boolean,
): boolean {
  if (event.key !== "Enter") return false;
  if (event.isComposing || event.keyCode === 229) return false;
  if (event.shiftKey || event.altKey) return false;
  if (event.ctrlKey || event.metaKey) return true;
  return !coarsePointer;
}

/** The soft keyboard's Enter label, matching what Enter does. */
export const enterKeyHintFor = (coarsePointer: boolean) =>
  coarsePointer ? "enter" : "send";

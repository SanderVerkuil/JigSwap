// Composer helpers for message formatting: Ctrl/Cmd+B/I/U wrap the selection
// in markers (see parseMessageMarkup in @jigswap/contracts), and text (an
// emoji) can be inserted at the caret. The edits are pure; applyTextEdit puts
// one into a textarea while keeping native undo.

/** Replace value[replaceStart, replaceEnd) with insert, then select [selStart, selEnd). */
export type TextEdit = {
  replaceStart: number;
  replaceEnd: number;
  insert: string;
  selStart: number;
  selEnd: number;
};

export type Marker = "**" | "*" | "__";

const fits = (value: string, edit: TextEdit, maxLength: number) =>
  value.length - (edit.replaceEnd - edit.replaceStart) + edit.insert.length <=
  maxLength;

/** Length of the run of `ch` ending at `end` (exclusive), going left. */
const runBefore = (value: string, end: number, ch: string, limit = 0) => {
  let n = 0;
  while (end - n - 1 >= limit && value[end - n - 1] === ch) n++;
  return n;
};
/** Length of the run of `ch` starting at `start`, going right. */
const runAfter = (
  value: string,
  start: number,
  ch: string,
  limit = value.length,
) => {
  let n = 0;
  while (start + n < limit && value[start + n] === ch) n++;
  return n;
};

/**
 * Whether marker runs of these lengths around a text already apply `marker`.
 * `*` is italic only on odd runs (1 or 3), since `**` alone is bold.
 */
const isOn = (marker: Marker, left: number, right: number) => {
  const run = Math.min(left, right);
  return marker === "*" ? run % 2 === 1 : run >= 2;
};

export function applyMarker(
  value: string,
  selStart: number,
  selEnd: number,
  marker: Marker,
  maxLength: number,
): TextEdit | null {
  const m = marker.length;
  const ch = marker[0]!;
  let edit: TextEdit;

  if (selStart === selEnd) {
    edit = {
      replaceStart: selStart,
      replaceEnd: selStart,
      insert: marker + marker,
      selStart: selStart + m,
      selEnd: selStart + m,
    };
  } else if (value.slice(selStart, selEnd).includes("\n")) {
    // Spans never cross a newline: wrap each non-empty line on its own.
    const insert = value
      .slice(selStart, selEnd)
      .split("\n")
      .map((line) =>
        line.replace(/^(\s*)(.*?)(\s*)$/su, (all, lead, text, trail) =>
          text ? `${lead}${marker}${text}${marker}${trail}` : all,
        ),
      )
      .join("\n");
    edit = {
      replaceStart: selStart,
      replaceEnd: selEnd,
      insert,
      selStart,
      selEnd: selStart + insert.length,
    };
  } else {
    // Keep edge whitespace outside the markers, so they still flank the text.
    let a = selStart;
    let b = selEnd;
    while (a < b && /\s/u.test(value[a]!)) a++;
    while (b > a && /\s/u.test(value[b - 1]!)) b--;
    if (a === b) return null;

    const outerLeft = runBefore(value, a, ch);
    const outerRight = runAfter(value, b, ch);
    const innerLeft = runAfter(value, a, ch, b);
    const innerRight = runBefore(value, b, ch, a + innerLeft);
    if (isOn(marker, outerLeft, outerRight)) {
      // Already wrapped: remove the markers next to the text.
      const inner = value.slice(a, b);
      edit = {
        replaceStart: a - m,
        replaceEnd: b + m,
        insert: inner,
        selStart: a - m,
        selEnd: b - m,
      };
    } else if (
      innerLeft + innerRight < b - a &&
      isOn(marker, innerLeft, innerRight)
    ) {
      // The selection includes the markers: unwrap it.
      const inner = value.slice(a + m, b - m);
      edit = {
        replaceStart: a,
        replaceEnd: b,
        insert: inner,
        selStart: a,
        selEnd: a + inner.length,
      };
    } else {
      edit = {
        replaceStart: a,
        replaceEnd: b,
        insert: marker + value.slice(a, b) + marker,
        selStart: a + m,
        selEnd: b + m,
      };
    }
  }
  return fits(value, edit, maxLength) ? edit : null;
}

/** Insert `text` over the selection, leaving the caret after it. */
export function replaceSelection(
  value: string,
  selStart: number,
  selEnd: number,
  text: string,
  maxLength: number,
): TextEdit | null {
  const edit = {
    replaceStart: selStart,
    replaceEnd: selEnd,
    insert: text,
    selStart: selStart + text.length,
    selEnd: selStart + text.length,
  };
  return fits(value, edit, maxLength) ? edit : null;
}

type ShortcutKey = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/** Cmd on macOS/iOS, Ctrl elsewhere; B bold, I italic, U underline. */
export function markerForShortcut(
  event: ShortcutKey,
  isMac: boolean,
): Marker | null {
  const mod = isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  if (!mod || event.shiftKey || event.altKey) return null;
  switch (event.key.toLowerCase()) {
    case "b":
      return "**";
    case "i":
      return "*";
    case "u":
      return "__";
    default:
      return null;
  }
}

export const isMacPlatform = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/**
 * Apply an edit to a textarea. execCommand("insertText") keeps native undo and
 * fires `input` (so the controlled onChange runs); where it is unavailable the
 * value is set directly and handed to `onValue` instead.
 */
export function applyTextEdit(
  textarea: HTMLTextAreaElement,
  edit: TextEdit,
  onValue: (value: string) => void,
) {
  textarea.focus();
  textarea.setSelectionRange(edit.replaceStart, edit.replaceEnd);
  const inserted =
    typeof document.execCommand === "function" &&
    document.execCommand("insertText", false, edit.insert);
  if (!inserted) {
    textarea.setRangeText(edit.insert, edit.replaceStart, edit.replaceEnd);
    onValue(textarea.value);
  }
  textarea.setSelectionRange(edit.selStart, edit.selEnd);
}

/** The composer's keydown handling for Cmd/Ctrl+B/I/U; true when handled. */
export function handleMarkupShortcut(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  maxLength: number,
  onValue: (value: string) => void,
): boolean {
  const marker = markerForShortcut(event, isMacPlatform());
  if (!marker) return false;
  // Also stops the browser's own Ctrl+B / Ctrl+U (Firefox sidebar, view source).
  event.preventDefault();
  const textarea = event.currentTarget;
  const edit = applyMarker(
    textarea.value,
    textarea.selectionStart,
    textarea.selectionEnd,
    marker,
    maxLength,
  );
  if (edit) applyTextEdit(textarea, edit, onValue);
  return true;
}

/** For the textarea's aria-keyshortcuts. */
export const MARKUP_KEYSHORTCUTS =
  "Control+B Control+I Control+U Meta+B Meta+I Meta+U";

import { describe, expect, it } from "vitest";
import {
  applyMarker,
  markerForShortcut,
  replaceSelection,
  type Marker,
  type TextEdit,
} from "./markup-shortcuts";

// Applies an edit to a string, returning the text with the new selection
// marked as [ … ] (or | for a caret), so the cases read at a glance.
function run(text: string, marker: Marker, max = 4000): string | null {
  const start = text.indexOf("[");
  const caret = text.indexOf("|");
  let value: string;
  let selStart: number;
  let selEnd: number;
  if (start !== -1) {
    const end = text.indexOf("]");
    value =
      text.slice(0, start) + text.slice(start + 1, end) + text.slice(end + 1);
    selStart = start;
    selEnd = end - 1;
  } else {
    value = text.slice(0, caret) + text.slice(caret + 1);
    selStart = selEnd = caret;
  }
  const edit = applyMarker(value, selStart, selEnd, marker, max);
  if (!edit) return null;
  return show(value, edit);
}

function show(value: string, edit: TextEdit): string {
  const next =
    value.slice(0, edit.replaceStart) +
    edit.insert +
    value.slice(edit.replaceEnd);
  return edit.selStart === edit.selEnd
    ? `${next.slice(0, edit.selStart)}|${next.slice(edit.selStart)}`
    : `${next.slice(0, edit.selStart)}[${next.slice(edit.selStart, edit.selEnd)}]${next.slice(edit.selEnd)}`;
}

describe("applyMarker", () => {
  it.each([
    // empty selection: the pair, caret between
    ["a |b", "**", "a **|**b"],
    ["|", "*", "*|*"],
    // wrap a selection, keeping it selected
    ["say [hi] now", "**", "say **[hi]** now"],
    ["say [hi] now", "*", "say *[hi]* now"],
    ["say [hi] now", "__", "say __[hi]__ now"],
    // whitespace at the edges stays outside the markers
    ["say[ hi ]now", "**", "say **[hi]** now"],
    // toggle off: markers just outside the selection
    ["say **[hi]** now", "**", "say [hi] now"],
    ["say *[hi]* now", "*", "say [hi] now"],
    // toggle off: markers inside the selection
    ["say [**hi**] now", "**", "say [hi] now"],
    // italic on bold adds italic; italic off from bold-italic keeps bold
    ["**[hi]**", "*", "***[hi]***"],
    ["***[hi]***", "*", "**[hi]**"],
    ["***[hi]***", "**", "*[hi]*"],
    // bold on italic adds bold
    ["*[hi]*", "**", "***[hi]***"],
    // several lines: each non-empty line wrapped on its own
    ["[one\n\n two]", "**", "[**one**\n\n **two**]"],
  ] as [string, Marker, string][])(
    "%j with %j -> %j",
    (input, marker, expected) => {
      expect(run(input, marker)).toBe(expected);
    },
  );

  it("does nothing for a whitespace-only selection", () => {
    expect(run("a[   ]b", "**")).toBeNull();
  });

  it("does nothing when the result would exceed the length limit", () => {
    expect(run("[abc]", "**", 6)).toBeNull();
    expect(run("[abc]", "**", 7)).toBe("**[abc]**");
  });
});

describe("markerForShortcut", () => {
  const key = (
    k: string,
    mods: Partial<
      Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>
    > = {},
  ) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it.each([
    ["b", "**"],
    ["B", "**"],
    ["i", "*"],
    ["u", "__"],
  ])("Ctrl+%s gives %j off a Mac", (k, marker) => {
    expect(markerForShortcut(key(k, { ctrlKey: true }), false)).toBe(marker);
  });

  it("uses Cmd on a Mac, and leaves Ctrl alone there", () => {
    expect(markerForShortcut(key("b", { metaKey: true }), true)).toBe("**");
    expect(markerForShortcut(key("b", { ctrlKey: true }), true)).toBeNull();
    expect(markerForShortcut(key("b", { metaKey: true }), false)).toBeNull();
  });

  it("ignores other keys and extra modifiers", () => {
    expect(markerForShortcut(key("k", { ctrlKey: true }), false)).toBeNull();
    expect(markerForShortcut(key("b"), false)).toBeNull();
    expect(
      markerForShortcut(key("b", { ctrlKey: true, shiftKey: true }), false),
    ).toBeNull();
    expect(
      markerForShortcut(key("b", { ctrlKey: true, altKey: true }), false),
    ).toBeNull();
  });
});

describe("replaceSelection", () => {
  it("inserts at the caret, replacing the selection", () => {
    expect(show("ab cd", replaceSelection("ab cd", 2, 2, "🧩", 4000)!)).toBe(
      "ab🧩| cd",
    );
    expect(show("ab cd", replaceSelection("ab cd", 0, 2, "🧩", 4000)!)).toBe(
      "🧩| cd",
    );
  });

  it("does nothing past the length limit", () => {
    expect(replaceSelection("abc", 3, 3, "🧩", 4)).toBeNull();
  });
});

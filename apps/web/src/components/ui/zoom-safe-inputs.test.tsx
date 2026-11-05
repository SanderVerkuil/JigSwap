// @vitest-environment happy-dom
import { promises as fs } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Command, CommandInput } from "./command";
import { Input } from "./input";
import { Textarea } from "./textarea";

// iOS zooms the page into any focused field whose text is under 16px (UX-71). The shared fields
// keep 16px (text-base) on touch at every width, including the 820px touch tablet, and only drop
// to 14px from md up on a pointer that is not coarse (mouse/trackpad desktops).

afterEach(cleanup);

const classes = (el: Element) => el.getAttribute("class")?.split(/\s+/) ?? [];

describe("zoom-safe text fields", () => {
  it.each([
    ["Input", () => render(<Input aria-label="Field" />)],
    ["Textarea", () => render(<Textarea aria-label="Field" />)],
    [
      "CommandInput",
      () =>
        render(
          <Command>
            <CommandInput aria-label="Field" />
          </Command>,
        ),
    ],
  ])("%s is 16px on touch and 14px only on a non-touch md+ screen", (_, r) => {
    r();
    const list = classes(screen.getByLabelText("Field"));
    expect(list).toContain("text-base");
    expect(list).toContain("md:not-pointer-coarse:text-sm");
    // No unconditional or width-only small size that would also apply on a touch tablet.
    expect(list).not.toContain("text-sm");
    expect(list).not.toContain("md:text-sm");
  });
});

// The same rule for every text field the app renders, including hand-rolled <input>, <textarea>
// and <select> elements and callers that pass their own size to Input/Textarea: a font size under
// 16px must carry the not-pointer-coarse variant, so touch devices never get it.
const FIELD_TAG = /<(input|textarea|select|Input|Textarea|CommandInput)\b/g;
const NOT_A_TEXT_FIELD =
  /\btype=["'](radio|checkbox|file|hidden|range|color)["']/;
const SMALL_TEXT = /^text-(xs|sm|\[(\d+(?:\.\d+)?)px\])$/;

// The JSX opening tag that starts at `start`, up to its own ">" (not the one in an arrow
// function inside a prop), skipping strings and comments.
function openingTag(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = source.indexOf(ch, i + 1);
      if (i < 0) break;
    } else if (depth > 0 && source.startsWith("//", i)) {
      i = source.indexOf("\n", i);
      if (i < 0) break;
    } else if (depth > 0 && source.startsWith("/*", i)) {
      i = source.indexOf("*/", i) + 1;
      if (i <= 0) break;
    } else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

// The class tokens a tag's className can produce: every string literal in its value.
function classTokens(tag: string): string[] {
  const at = tag.indexOf("className=");
  if (at < 0) return [];
  const value = openingTag(tag.slice(at + "className=".length), 0);
  return [...value.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)].flatMap((m) =>
    (m[1] ?? m[2] ?? m[3]).split(/\s+/).filter(Boolean),
  );
}

// A font size under 16px that also applies on a coarse pointer. file: and placeholder: style
// the file button and the hint text, not the text the member types.
function smallOnTouch(token: string): boolean {
  const variants = token.split(":");
  const size = SMALL_TEXT.exec(variants.pop()!.replace(/^!/, ""));
  if (!size || (size[2] && Number(size[2]) >= 16)) return false;
  return !variants.some((v) =>
    ["not-pointer-coarse", "file", "placeholder"].includes(v),
  );
}

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (/\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name))
      out.push(full);
  }
  return out;
}

describe("zoom-safe text fields across the app", () => {
  it("finds a hand-rolled field's size past an arrow-function prop", () => {
    const tag = openingTag(
      `<textarea onChange={(e) => set(e)} className={cn("w-full text-[15px]", x && "a")} />`,
      0,
    );
    expect(classTokens(tag).filter(smallOnTouch)).toEqual(["text-[15px]"]);
    expect(
      ["text-base", "md:not-pointer-coarse:text-sm", "file:text-sm"].filter(
        smallOnTouch,
      ),
    ).toEqual([]);
  });

  it("never gives a text field under 16px on a touch device", async () => {
    const root = path.resolve(__dirname, "../..");
    const offenders: string[] = [];
    for (const file of await sourceFiles(root)) {
      const source = await fs.readFile(file, "utf8");
      for (const match of source.matchAll(FIELD_TAG)) {
        const tag = openingTag(source, match.index);
        if (NOT_A_TEXT_FIELD.test(tag)) continue;
        const small = classTokens(tag).filter(smallOnTouch);
        if (small.length > 0) {
          const line = source.slice(0, match.index).split("\n").length;
          offenders.push(
            `${path.relative(root, file)}:${line} ${small.join(" ")}`,
          );
        }
      }
    }
    expect(
      offenders,
      "Use text-base with md:not-pointer-coarse:<size> so iOS does not zoom on focus",
    ).toEqual([]);
  });
});

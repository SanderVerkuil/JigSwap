/**
 * Message markup: a small Discord-style subset parsed from a plain-text
 * message body. Shared by the backend (plain-text previews) and the web app
 * (rendering), so both see exactly the same formatting.
 *
 * Grammar (see docs/superpowers/specs/2026-10-19-message-rich-text-design.md):
 * `**strong**`, `*em*` / `_em_`, `__underline__`, `~~strike~~`, `` `code` ``
 * and bare `http(s)://` / `www.` links. Lines are parsed independently, the
 * scan is a single index loop (linear time), and the output never contains
 * HTML: callers render nodes as elements or join them as plain text.
 */

export type MarkupNode =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; href: string; text: string }
  | { type: "strong" | "em" | "underline" | "strike"; children: MarkupNode[] };

type ElementType = "strong" | "em" | "underline" | "strike";

/** Delimiter kind: marker char + run length. `*1` and `_1` are distinct. */
type DelimKind = "*1" | "*2" | "_1" | "_2" | "~2";

const KIND_TYPE: Record<DelimKind, ElementType> = {
  "*1": "em",
  "*2": "strong",
  _1: "em",
  _2: "underline",
  "~2": "strike",
};

type Token =
  | { t: "text"; value: string }
  | { t: "code"; value: string }
  | { t: "link"; href: string; text: string }
  | { t: "delim"; kind: DelimKind; raw: string; match: -1 | number };

const ESCAPABLE = new Set(["\\", "*", "_", "~", "`"]);
const LINK_PREFIXES = ["https://", "http://", "www."];
const TRAILING_PUNCT = new Set([".", ",", ":", ";", "!", "?", "'", '"']);
// Markers right after a URL are formatting, not part of the URL, so
// `**https://x.nl**` bolds the link.
const TRAILING_MARKERS = new Set(["*", "_", "~"]);

const isWordChar = (ch: string | undefined): boolean =>
  ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
const isSpace = (ch: string | undefined): boolean =>
  ch !== undefined && /\s/u.test(ch);

/** The full code point ending at index `i - 1` (handles surrogate pairs). */
function charBefore(line: string, i: number): string | undefined {
  if (i <= 0) return undefined;
  const low = line.charCodeAt(i - 1);
  if (low >= 0xdc00 && low <= 0xdfff && i >= 2) {
    const high = line.charCodeAt(i - 2);
    if (high >= 0xd800 && high <= 0xdbff) return line.slice(i - 2, i);
  }
  return line[i - 1];
}

/** The full code point starting at index `i`. */
function charAt(line: string, i: number): string | undefined {
  if (i >= line.length) return undefined;
  const cp = line.codePointAt(i);
  return cp === undefined ? undefined : String.fromCodePoint(cp);
}

function startsWithPrefix(line: string, i: number): string | undefined {
  for (const prefix of LINK_PREFIXES) {
    if (line.substr(i, prefix.length).toLowerCase() === prefix) return prefix;
  }
  return undefined;
}

/** End index (exclusive) of a URL candidate after GFM-style trimming. */
function trimUrlEnd(line: string, start: number, end: number): number {
  let opens = 0;
  let closes = 0;
  for (let k = start; k < end; k++) {
    if (line[k] === "(") opens++;
    else if (line[k] === ")") closes++;
  }
  while (end > start) {
    const ch = line[end - 1]!;
    if (TRAILING_PUNCT.has(ch) || TRAILING_MARKERS.has(ch)) {
      end--;
    } else if (ch === ")" && closes > opens) {
      closes--;
      end--;
    } else {
      break;
    }
  }
  return end;
}

function safeHref(text: string, prefix: string): string | undefined {
  if (text.length <= prefix.length) return undefined;
  const candidate = prefix === "www." ? `https://${text}` : text;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let text = "";
  const flush = () => {
    if (text) tokens.push({ t: "text", value: text });
    text = "";
  };
  // Open delimiters, by token index. A kind is never open twice, so this
  // holds at most five entries.
  const stack: number[] = [];
  const openKinds = new Set<DelimKind>();

  const pushDelim = (
    kind: DelimKind,
    raw: string,
    canOpen: boolean,
    canClose: boolean,
  ) => {
    if (openKinds.has(kind)) {
      let opener = -1;
      for (const idx of stack) {
        if ((tokens[idx] as { kind: DelimKind }).kind === kind) opener = idx;
      }
      // Closing straight after the opener would be an empty span.
      const empty = opener === tokens.length - 1 && text === "";
      if (canClose && !empty) {
        flush();
        while (stack.length > 0) {
          const top = stack.pop()!;
          openKinds.delete((tokens[top] as { kind: DelimKind }).kind);
          if (top === opener) break;
        }
        (tokens[opener] as { match: number }).match = tokens.length;
        tokens.push({ t: "delim", kind, raw, match: opener });
        return;
      }
      text += raw;
      return;
    }
    if (canOpen) {
      flush();
      stack.push(tokens.length);
      openKinds.add(kind);
      tokens.push({ t: "delim", kind, raw, match: -1 });
      return;
    }
    text += raw;
  };

  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;

    if (ch === "\\" && i + 1 < line.length && ESCAPABLE.has(line[i + 1]!)) {
      text += line[i + 1];
      i += 2;
      continue;
    }

    if (ch === "`") {
      let run = 1;
      while (line[i + run] === "`") run++;
      if (run === 1) {
        const close = line.indexOf("`", i + 1);
        if (close > i + 1 && line[close + 1] !== "`") {
          flush();
          tokens.push({ t: "code", value: line.slice(i + 1, close) });
          i = close + 1;
          continue;
        }
      }
      text += line.slice(i, i + run);
      i += run;
      continue;
    }

    if (ch === "h" || ch === "H" || ch === "w" || ch === "W") {
      const prefix = isWordChar(charBefore(line, i))
        ? undefined
        : startsWithPrefix(line, i);
      if (prefix) {
        let end = i;
        while (end < line.length && !isSpace(line[end])) end++;
        const trimmed = trimUrlEnd(line, i, end);
        const raw = line.slice(i, trimmed);
        const href = safeHref(raw, prefix);
        if (href) {
          flush();
          tokens.push({ t: "link", href, text: raw });
        } else {
          // An invalid candidate stays literal as a whole, so the scan never
          // revisits it (keeps the loop linear).
          text += raw;
        }
        i = Math.max(trimmed, i + 1);
        continue;
      }
    }

    if (ch === "*" || ch === "_" || ch === "~") {
      let run = 1;
      while (line[i + run] === ch) run++;
      const before = charBefore(line, i);
      const after = charAt(line, i + run);
      const canOpen =
        after !== undefined && !isSpace(after) && !isWordChar(before);
      const canClose =
        before !== undefined && !isSpace(before) && !isWordChar(after);
      const raw = line.slice(i, i + run);
      i += run;

      if (ch === "~") {
        if (run === 2) pushDelim("~2", raw, canOpen, canClose);
        else text += raw;
        continue;
      }
      const c = ch as "*" | "_";
      if (run === 1) pushDelim(`${c}1`, raw, canOpen, canClose);
      else if (run === 2) pushDelim(`${c}2`, raw, canOpen, canClose);
      else if (run === 3) {
        // Opening: outer (strong/underline) first, then em. Closing: reverse.
        const closing =
          canClose && (openKinds.has(`${c}1`) || openKinds.has(`${c}2`));
        const order: DelimKind[] = closing
          ? [`${c}1`, `${c}2`]
          : [`${c}2`, `${c}1`];
        for (const kind of order) {
          pushDelim(kind, c.repeat(kind[1] === "1" ? 1 : 2), canOpen, canClose);
        }
      } else text += raw;
      continue;
    }

    text += ch;
    i++;
  }
  flush();
  return tokens;
}

function pushText(out: MarkupNode[], value: string) {
  const last = out[out.length - 1];
  if (last?.type === "text") last.value += value;
  else out.push({ type: "text", value });
}

function buildTree(tokens: Token[], out: MarkupNode[]) {
  const frames: MarkupNode[][] = [out];
  tokens.forEach((token, index) => {
    const target = frames[frames.length - 1]!;
    switch (token.t) {
      case "text":
        pushText(target, token.value);
        break;
      case "code":
        target.push({ type: "code", value: token.value });
        break;
      case "link":
        target.push({ type: "link", href: token.href, text: token.text });
        break;
      case "delim":
        if (token.match === -1) {
          pushText(target, token.raw);
        } else if (token.match > index) {
          const children: MarkupNode[] = [];
          target.push({ type: KIND_TYPE[token.kind], children });
          frames.push(children);
        } else {
          frames.pop();
        }
        break;
    }
  });
}

export function parseMessageMarkup(body: string): MarkupNode[] {
  const out: MarkupNode[] = [];
  const lines = body.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) pushText(out, "\n");
    buildTree(tokenizeLine(line), out);
  });
  return out;
}

function toPlainText(nodes: MarkupNode[]): string {
  let result = "";
  for (const node of nodes) {
    if (node.type === "text" || node.type === "code") result += node.value;
    else if (node.type === "link") result += node.text;
    else result += toPlainText(node.children);
  }
  return result;
}

/**
 * The body as plain text: markers that would format are removed, literal
 * markers stay, escapes are unescaped, links become their visible text.
 * Whitespace is untouched (callers collapse it as before).
 */
export function stripFormatting(body: string): string {
  return toPlainText(parseMessageMarkup(body));
}

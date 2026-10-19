import { describe, expect, it } from "vitest";
import {
  parseMessageMarkup,
  stripFormatting,
  type MarkupNode,
} from "./message-markup";

const t = (value: string): MarkupNode => ({ type: "text", value });
const code = (value: string): MarkupNode => ({ type: "code", value });
const link = (href: string, text: string): MarkupNode => ({
  type: "link",
  href,
  text,
});
const el =
  (type: "strong" | "em" | "underline" | "strike") =>
  (...children: MarkupNode[]): MarkupNode => ({ type, children });
const strong = el("strong");
const em = el("em");
const u = el("underline");
const s = el("strike");

/** Text a renderer would show: the same walk the web renderer does. */
function renderedText(nodes: MarkupNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === "text" || n.type === "code") return n.value;
      if (n.type === "link") return n.text;
      return renderedText(n.children);
    })
    .join("");
}

describe("parseMessageMarkup: styles", () => {
  it.each<[string, MarkupNode[]]>([
    ["**bold**", [strong(t("bold"))]],
    ["*italic*", [em(t("italic"))]],
    ["_italic_", [em(t("italic"))]],
    ["__under__", [u(t("under"))]],
    ["~~gone~~", [s(t("gone"))]],
    ["`x = 1`", [code("x = 1")]],
    ["***both***", [strong(em(t("both")))]],
    ["___both___", [u(em(t("both")))]],
    ["a **b** c", [t("a "), strong(t("b")), t(" c")]],
    ["(**x**),", [t("("), strong(t("x")), t("),")]],
  ])("%j", (body, expected) => {
    expect(parseMessageMarkup(body)).toEqual(expected);
  });

  it("returns an empty list for an empty body", () => {
    expect(parseMessageMarkup("")).toEqual([]);
  });

  it("nests different kinds", () => {
    expect(parseMessageMarkup("**a _b_ ~~c~~**")).toEqual([
      strong(t("a "), em(t("b")), t(" "), s(t("c"))),
    ]);
  });

  it("closes a triple run inner-first", () => {
    expect(parseMessageMarkup("**a *b***")).toEqual([
      strong(t("a "), em(t("b"))),
    ]);
  });

  it("drops a crossing opener back to literal text (mismatched nesting)", () => {
    expect(parseMessageMarkup("**a *b** c*")).toEqual([
      strong(t("a *b")),
      t(" c*"),
    ]);
  });

  it("does not let * and _ close each other", () => {
    expect(parseMessageMarkup("*a_")).toEqual([t("*a_")]);
    expect(parseMessageMarkup("*a _b_*")).toEqual([em(t("a "), em(t("b")))]);
  });
});

describe("parseMessageMarkup: things that stay literal", () => {
  it.each([
    "snake_case_name",
    "2*3*4",
    "a**b**c",
    "5 * 3 = 15",
    "* note",
    "~ 20 min",
    "~200 pieces",
    "~single~",
    "****",
    "~~~~",
    "*****x*****",
    "** spaced **",
    "*unclosed",
    "closer only*",
    "`unclosed",
    "``double``",
    "```js```",
    "C:\\Users\\x",
    "café*x*",
    "日本*語*",
  ])("%j", (body) => {
    const plain = body;
    expect(parseMessageMarkup(body)).toEqual([t(plain)]);
  });

  it("underlines __init__ (both markers flank correctly)", () => {
    expect(parseMessageMarkup("__init__")).toEqual([u(t("init"))]);
  });
});

describe("parseMessageMarkup: escapes", () => {
  it.each<[string, MarkupNode[]]>([
    ["\\*not italic\\*", [t("*not italic*")]],
    ["\\_x\\_", [t("_x_")]],
    ["\\~~x~~", [t("~~x~~")]],
    ["\\`x\\`", [t("`x`")]],
    ["C:\\\\share", [t("C:\\share")]],
    ["\\a stays", [t("\\a stays")]],
    ["trailing \\", [t("trailing \\")]],
    ["*a \\* b*", [em(t("a * b"))]],
  ])("%j", (body, expected) => {
    expect(parseMessageMarkup(body)).toEqual(expected);
  });

  it("does not unescape inside a code span", () => {
    expect(parseMessageMarkup("`\\*`")).toEqual([code("\\*")]);
  });

  it("keeps markers and URLs literal inside a code span", () => {
    expect(parseMessageMarkup("`**a** https://x.nl`")).toEqual([
      code("**a** https://x.nl"),
    ]);
  });
});

describe("parseMessageMarkup: lines", () => {
  it("keeps newlines in text nodes", () => {
    expect(parseMessageMarkup("one\ntwo\n\nthree")).toEqual([
      t("one\ntwo\n\nthree"),
    ]);
  });

  it("never lets a span cross a newline", () => {
    expect(parseMessageMarkup("**line1\nline2**")).toEqual([
      t("**line1\nline2**"),
    ]);
    expect(parseMessageMarkup("`a\nb`")).toEqual([t("`a\nb`")]);
  });

  it("formats each line on its own", () => {
    expect(parseMessageMarkup("*a*\n**b**")).toEqual([
      em(t("a")),
      t("\n"),
      strong(t("b")),
    ]);
  });
});

describe("parseMessageMarkup: links", () => {
  it.each<[string, MarkupNode[]]>([
    ["https://x.nl", [link("https://x.nl/", "https://x.nl")]],
    [
      "see https://x.nl/a_b_c ok",
      [t("see "), link("https://x.nl/a_b_c", "https://x.nl/a_b_c"), t(" ok")],
    ],
    [
      "(see https://x.nl/a).",
      [t("(see "), link("https://x.nl/a", "https://x.nl/a"), t(").")],
    ],
    [
      "https://en.wikipedia.org/wiki/Foo_(bar)",
      [
        link(
          "https://en.wikipedia.org/wiki/Foo_(bar)",
          "https://en.wikipedia.org/wiki/Foo_(bar)",
        ),
      ],
    ],
    ["www.x.nl!", [link("https://www.x.nl/", "www.x.nl"), t("!")]],
    ["HTTPS://X.NL", [link("https://x.nl/", "HTTPS://X.NL")]],
    ["http://x.nl?", [link("http://x.nl/", "http://x.nl"), t("?")]],
    [
      'say "https://x.nl"',
      [t('say "'), link("https://x.nl/", "https://x.nl"), t('"')],
    ],
    [
      "**https://x.nl** ",
      [strong(link("https://x.nl/", "https://x.nl")), t(" ")],
    ],
  ])("%j", (body, expected) => {
    expect(parseMessageMarkup(body)).toEqual(expected);
  });

  it("needs a non-alphanumeric character before the prefix", () => {
    expect(parseMessageMarkup("xhttps://x.nl")).toEqual([t("xhttps://x.nl")]);
    expect(parseMessageMarkup("awww.x.nl")).toEqual([t("awww.x.nl")]);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox",
    "http://",
    "https://",
    "http://javascript:alert(1)",
    '<a href="x">hi</a>',
    "<script>alert(1)</script>",
    "&lt;b&gt; &amp;",
  ])("never links or interprets %j", (body) => {
    const nodes = parseMessageMarkup(body);
    expect(nodes).toEqual([t(body)]);
  });

  it("encodes href rather than passing raw characters through", () => {
    const [node] = parseMessageMarkup("https://x.nl/<b>");
    expect(node).toEqual(link("https://x.nl/%3Cb%3E", "https://x.nl/<b>"));
  });
});

describe("parseMessageMarkup: non-Latin and emoji", () => {
  it.each<[string, MarkupNode[]]>([
    ["**é**", [strong(t("é"))]],
    ["*日本語*", [em(t("日本語"))]],
    ["🧩**puzzle**🧩", [t("🧩"), strong(t("puzzle")), t("🧩")]],
    ["**🧩**", [strong(t("🧩"))]],
    ["_привет_", [em(t("привет"))]],
  ])("%j", (body, expected) => {
    expect(parseMessageMarkup(body)).toEqual(expected);
  });
});

describe("parseMessageMarkup: pathological input stays linear", () => {
  // Spec target is < 50 ms per case. We assert a generous 500 ms so a slow
  // CI runner can't flake; a quadratic scan on 40k chars takes seconds.
  const N = 40_000;
  const cases: [string, string][] = [
    ["*", "*".repeat(N)],
    ["**a", "**a".repeat(N / 3)],
    ["_a", "_a".repeat(N / 2)],
    ["`a", "`a".repeat(N / 2)],
    ["\\\\", "\\\\".repeat(N / 2)],
    ["http://(", "http://(".repeat(N / 8)],
    ["*_~", "*_~".repeat(N / 3)],
    ["a *b", "a *b".repeat(N / 4)],
    ["www.", " www.".repeat(N / 5)],
  ];
  it.each(cases)("40k of %j", (_label, body) => {
    const start = performance.now();
    const nodes = parseMessageMarkup(body);
    stripFormatting(body);
    const elapsed = performance.now() - start;
    expect(renderedText(nodes).length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
  });
});

describe("stripFormatting", () => {
  it.each<[string, string]>([
    ["**hi** _there_", "hi there"],
    ["~~a~~ __b__ `c`", "a b c"],
    ["***x***", "x"],
    ["snake_case 2*3*4", "snake_case 2*3*4"],
    ["\\*x\\*", "*x*"],
    ["see https://x.nl/a_b", "see https://x.nl/a_b"],
    ["**a\nb**", "**a\nb**"],
    ["  spaced  \n\n out ", "  spaced  \n\n out "],
  ])("%j -> %j", (body, expected) => {
    expect(stripFormatting(body)).toBe(expected);
  });

  it("is not idempotent across escapes (documented)", () => {
    const once = stripFormatting("\\*x\\*");
    expect(once).toBe("*x*");
    expect(stripFormatting(once)).toBe("x");
  });

  it.each([
    "**bold** *it* _it_ __u__ ~~s~~ `c`",
    "**a *b** c*",
    "**a *b***",
    "snake_case_name 2*3*4 a**b**c 5 * 3",
    "\\*esc\\* C:\\\\share \\a `\\*`",
    "(see https://x.nl/a). www.x.nl! javascript:alert(1)",
    "🧩**puzzle**🧩 *日本語* café*x*",
    "**line1\nline2** *a*\n**b**",
    "<script>alert(1)</script> &amp;",
    "",
  ])("round-trips: rendered text of %j equals stripFormatting", (body) => {
    expect(renderedText(parseMessageMarkup(body))).toBe(stripFormatting(body));
  });
});

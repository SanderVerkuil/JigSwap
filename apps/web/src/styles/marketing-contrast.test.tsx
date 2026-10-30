import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MK_AVATAR_TONES } from "@/components/marketing/avatar-colors";
import { Eyebrow } from "@/components/marketing/section";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// WCAG 2 AA (4.5:1) guard for the marketing token layer. The tokens in
// marketing.css are color-mix() expressions over three seed colours, so the
// test resolves them the way the browser does (mixing in oklab) for the light
// (:root) and dark (.dark) blocks, then checks the text/surface pairs the
// marketing pages render.

type Rgb = readonly [number, number, number];
type Tokens = Readonly<Record<string, string>>;
type Mode = "light" | "dark";

const CSS = readFileSync(join(__dirname, "marketing.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function declarations(selector: string): Tokens {
  const open = CSS.indexOf(`${selector} {`);
  if (open < 0) throw new Error(`marketing.css has no "${selector}" block`);
  const body = CSS.slice(CSS.indexOf("{", open) + 1, CSS.indexOf("}", open));
  const tokens: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[name] = value.replace(/\s+/g, " ").trim();
  }
  return tokens;
}

const LIGHT = declarations(":root");
const MODES: Record<Mode, Tokens> = {
  light: LIGHT,
  dark: { ...LIGHT, ...declarations(".dark") },
};

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const fromLinear = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
const clamp = (c: number) => Math.min(1, Math.max(0, c));

function parseHex(value: string): Rgb {
  const h = value.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function toOklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => clamp(fromLinear(c))) as [number, number, number];
}

// Resolves a hex, var(--token) or `color-mix(in oklab, A p%, B)` value.
function resolve(value: string, tokens: Tokens): Rgb {
  const v = value.trim();
  if (v.startsWith("#")) return parseHex(v);
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) {
    const next = tokens[ref[1]];
    if (next === undefined) throw new Error(`unknown token ${ref[1]}`);
    return resolve(next, tokens);
  }
  const mix =
    /^color-mix\(\s*in oklab,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)\s*\)$/.exec(v);
  if (mix) {
    const p = Number(mix[2]) / 100;
    const a = toOklab(resolve(mix[1], tokens));
    const b = toOklab(resolve(mix[3], tokens));
    return fromOklab(
      [0, 1, 2].map((i) => a[i] * p + b[i] * (1 - p)) as [
        number,
        number,
        number,
      ],
    );
  }
  throw new Error(`unsupported colour value: ${v}`);
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: Rgb, bg: Rgb): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The marketing page ground, card and tinted band surfaces.
const SURFACES = ["--mk-bg", "--mk-card", "--mk-muted"] as const;
const AA = 4.5;

// The token behind an element's `text-mk-*` class in the given mode
// (`dark:text-mk-*` wins in dark mode).
function textToken(html: string, mode: Mode): string {
  const classes = /class="([^"]*)"/.exec(html)?.[1].split(/\s+/) ?? [];
  const pick = (pattern: RegExp) =>
    classes.map((c) => pattern.exec(c)?.[1]).find((t) => t !== undefined);
  const token =
    (mode === "dark" ? pick(/^dark:text-(mk-[\w-]+)$/) : undefined) ??
    pick(/^text-(mk-[\w-]+)$/);
  if (token === undefined) throw new Error(`no text-mk-* class in ${html}`);
  return `var(--${token})`;
}

describe.each(["light", "dark"] as const)("marketing contrast (%s)", (mode) => {
  const tokens = MODES[mode];
  const color = (value: string) => resolve(value, tokens);

  it.each(SURFACES)("muted text reaches AA on %s", (surface) => {
    expect(
      contrast(color("var(--mk-text-muted)"), color(`var(${surface})`)),
    ).toBeGreaterThanOrEqual(AA);
  });

  it.each(SURFACES)("the section eyebrow reaches AA on %s", (surface) => {
    const eyebrow = textToken(renderToStaticMarkup(<Eyebrow>x</Eyebrow>), mode);
    expect(
      contrast(color(eyebrow), color(`var(${surface})`)),
    ).toBeGreaterThanOrEqual(AA);
  });

  it.each(Object.entries(MK_AVATAR_TONES))(
    "%s avatar initials reach AA on their fill",
    (_, tone) => {
      expect(contrast(color(tone.fg), color(tone.bg))).toBeGreaterThanOrEqual(
        AA,
      );
    },
  );
});

describe("marketing contrast (light, white cards)", () => {
  it("muted text reaches AA on pure white", () => {
    expect(
      contrast(
        resolve("var(--mk-text-muted)", MODES.light),
        parseHex("#ffffff"),
      ),
    ).toBeGreaterThanOrEqual(AA);
  });
});

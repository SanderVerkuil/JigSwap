import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the WCAG contrast of the app colour tokens in globals.css (UX-10). It resolves the
// custom properties of :root and .dark the way the browser does (hex, oklch, color-mix in oklab,
// var()) and measures the pairs the UI actually renders. Text needs 4.5:1 (1.4.3).

type Rgb = readonly [number, number, number]; // linear sRGB, 0..1
type Oklab = readonly [number, number, number];

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const vars = new Map<string, string>();
  for (const m of body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    vars.set(m[1], m[2].replace(/\s+/g, " ").trim());
  }
  return vars;
}

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const clamp = (c: number) => Math.min(1, Math.max(0, c));

function oklabToLinear([L, a, b]: Oklab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function linearToOklab([r, g, b]: Rgb): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function resolve(value: string, vars: Map<string, string>): Rgb {
  const v = value.trim();
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  if (ref) {
    const next = vars.get(ref[1]);
    if (!next) throw new Error(`unknown ${ref[1]}`);
    return resolve(next, vars);
  }
  if (v === "white") return [1, 1, 1];
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return [0, 2, 4].map((i) =>
      toLinear(parseInt(hex[1].slice(i, i + 2), 16) / 255),
    ) as unknown as Rgb;
  }
  const lch = v.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  if (lch) {
    const [L, C, H] = lch.slice(1).map(Number);
    const h = (H * Math.PI) / 180;
    return oklabToLinear([L, C * Math.cos(h), C * Math.sin(h)]);
  }
  const mix = v.match(/^color-mix\( ?in oklab, (.+) ([\d.]+)%, (.+?) ?\)$/);
  if (mix) {
    const p = Number(mix[2]) / 100;
    const a = linearToOklab(resolve(mix[1], vars));
    const b = linearToOklab(resolve(mix[3], vars));
    return oklabToLinear(
      [0, 1, 2].map((i) => a[i] * p + b[i] * (1 - p)) as unknown as Oklab,
    );
  }
  throw new Error(`unsupported colour ${v}`);
}

// Tailwind's `bg-x/10` is x at 10% alpha, composited over the surface in sRGB.
function over(top: Rgb, alpha: number, under: Rgb): Rgb {
  const enc = (c: number) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return [0, 1, 2].map((i) =>
    toLinear(enc(top[i]) * alpha + enc(under[i]) * (1 - alpha)),
  ) as unknown as Rgb;
}

function contrast(fg: Rgb, bg: Rgb): number {
  const y = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const [hi, lo] = [y(fg), y(bg)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

const root = block(":root");
const themes = {
  light: root,
  dark: new Map([...root, ...block(".dark")]),
};

describe.each(Object.entries(themes))("%s theme tokens", (_name, vars) => {
  const c = (name: string) => resolve(`var(--${name})`, vars);
  const white: Rgb = [1, 1, 1];

  it("keeps muted text at AA on the app's surfaces", () => {
    for (const surface of [
      "background",
      "card",
      "muted",
      "accent",
      "sidebar",
      "sidebar-accent",
    ]) {
      expect(
        contrast(c("muted-foreground"), c(surface)),
        surface,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps white text at AA on the strong brand green", () => {
    expect(
      contrast(white, c("jigsaw-secondary-strong")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps green text at AA on surfaces and its own tints", () => {
    const text = c("jigsaw-secondary-text");
    const green = c("jigsaw-secondary");
    const surfaces: Record<string, Rgb> = {
      background: c("background"),
      card: c("card"),
      "secondary-tint": c("jigsaw-secondary-tint"),
      "secondary/10 on card": over(green, 0.1, c("card")),
      "secondary/15 on card": over(green, 0.15, c("card")),
    };
    for (const [surface, bg] of Object.entries(surfaces)) {
      expect(contrast(text, bg), surface).toBeGreaterThanOrEqual(4.5);
    }
  });
});

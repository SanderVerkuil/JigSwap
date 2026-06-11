// Color + lighting tokens for the 3D plank.
//
// The marketing palette stores colors as CSS custom properties whose values
// are color-mix()/oklab() expressions. Neither three.js Color.setStyle nor
// (reliably) canvas fillStyle can parse those, so resolution goes through
// the DOM: apply the value as a computed `color`, then read back concrete
// sRGB bytes via a 1x1 canvas.

let probeCtx: CanvasRenderingContext2D | null = null;

/**
 * Resolve any CSS color expression (var(), color-mix(), oklab()...) to a
 * #rrggbb hex string. `scope` must be an element inside the marketing DOM
 * subtree so the --mk-* variables are in scope.
 */
export function resolveCssColor(input: string, scope: HTMLElement): string {
  const el = document.createElement("span");
  el.style.color = input;
  scope.appendChild(el);
  const computed = getComputedStyle(el).color;
  el.remove();

  if (!probeCtx) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probeCtx = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!probeCtx) return "#888888";
  probeCtx.clearRect(0, 0, 1, 1);
  probeCtx.fillStyle = computed;
  probeCtx.fillRect(0, 0, 1, 1);
  const [r, g, b] = probeCtx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Resolve the marketing heading font stack for canvas text. */
export function resolveHeadingFont(scope: HTMLElement): string {
  const v = getComputedStyle(scope).getPropertyValue("--font-mk-heading").trim();
  return v || "system-ui, sans-serif";
}

// ——— theme lighting presets (spec: "Dark-mode lighting") ———

export interface LightingPreset {
  keyIntensity: number;
  keyColor: string;
  ambientIntensity: number;
  ambientColor: string;
  hemiIntensity: number;
  /** Violet rim light: 0 in light mode, visible in dark mode. */
  rimIntensity: number;
  shadowOpacity: number;
  shelfColor: string;
}

export const LIGHTING: Record<"light" | "dark", LightingPreset> = {
  light: {
    keyIntensity: 1.15,
    keyColor: "#fff6ea", // warm daylight key
    ambientIntensity: 0.55,
    ambientColor: "#ffffff",
    hemiIntensity: 0.35,
    rimIntensity: 0,
    shadowOpacity: 0.45,
    shelfColor: "#c98f4d",
  },
  dark: {
    keyIntensity: 0.65,
    keyColor: "#dfe6ff", // cool, dimmer key
    ambientIntensity: 0.3,
    ambientColor: "#cdd2f2",
    hemiIntensity: 0.18,
    rimIntensity: 0.9, // violet rim so silhouettes read on dark bg
    shadowOpacity: 0.28, // strong shadows read as holes on dark pages
    shelfColor: "#8a5f33",
  },
};

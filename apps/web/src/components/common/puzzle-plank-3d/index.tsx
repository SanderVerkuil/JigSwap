"use client";

import {
  PuzzlePlank,
  type PuzzlePlankBox,
} from "@/components/common/puzzle-plank";
import {
  resolveCssColor,
  resolveHeadingFont,
} from "@/components/marketing/plank-3d/palette";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { useTranslations } from "use-intl";
import type { PlankSceneProps } from "./scene";
import { DEFAULT_WOOD_PARAMS, type WoodParams } from "./wood-texture";

const PlankScene = React.lazy(() => import("./scene"));
const PlankScenePhysics = React.lazy(() => import("./scene-physics"));

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Render-nothing error boundary: any 3D failure leaves the CSS plank. */
class SceneBoundary extends React.Component<
  { children: React.ReactNode; onError?: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError?.();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function PuzzlePlank3D({
  boxes,
  interactive = false,
}: {
  boxes: PuzzlePlankBox[];
  /**
   * When true, loads the rapier physics scene (grab/drag/throw) instead of
   * the static scene. Only activates when WebGL is available and
   * prefers-reduced-motion is not set. Defaults to false so all existing
   * callers (dashboard, marketing hero) are unchanged.
   */
  interactive?: boolean;
}) {
  const container = React.useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false);
  const [sceneReady, setSceneReady] = React.useState(false);
  const [visible, setVisible] = React.useState(true);
  const [resolved, setResolved] = React.useState<
    PlankSceneProps["resolved"] | null
  >(null);
  const [headingFont, setHeadingFont] = React.useState("system-ui, sans-serif");
  // Bumped by the Reset button to snap the physics boxes back to their layout.
  const [resetNonce, setResetNonce] = React.useState(0);
  // TEMPORARY: live wood-grain tuning via the on-screen tweaks panel.
  const [woodParams, setWoodParams] =
    React.useState<WoodParams>(DEFAULT_WOOD_PARAMS);
  const t = useTranslations("shell");
  const reducedMotion = usePrefersReducedMotion();
  const { resolvedTheme } = useTheme();
  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";

  React.useEffect(() => {
    setMounted(supportsWebGL());
  }, []);

  // Resolve CSS-var colors + font from the live DOM; re-resolve when the
  // theme flips so box colors match the page's current palette.
  React.useEffect(() => {
    const el = container.current;
    if (!el || !mounted) return;
    setResolved(
      boxes.map((b) => ({
        c1: resolveCssColor(b.c1 ?? "var(--jigsaw-primary)", el),
        c2: resolveCssColor(b.c2 ?? "var(--jigsaw-primary)", el),
      })),
    );
    setHeadingFont(resolveHeadingFont(el, "--font-heading"));
  }, [boxes, mounted, theme]);

  // Pause the render loop when the widget is offscreen.
  React.useEffect(() => {
    const el = container.current;
    if (!el || !mounted) return;
    const io = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted]);

  // Empty boxes → nothing to render.
  if (boxes.length === 0) return null;

  const showScene = mounted && resolved !== null;
  // Use physics scene only when explicitly opted in, WebGL is available, and
  // reduced-motion is not active. `mounted` already gates on WebGL.
  const usePhysics = interactive && mounted && !reducedMotion;

  const sceneProps: PlankSceneProps = {
    boxes,
    resolved: resolved ?? [],
    headingFont,
    theme,
    reducedMotion,
    visible,
    onFirstFrame: () => setSceneReady(true),
    eventSource: container,
    resetNonce,
    woodParams,
  };

  return (
    <div
      ref={container}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      {/* CSS plank: fallback shown until the scene's first frame, or permanently
          when WebGL is unavailable or the scene boundary catches an error.
          Decorative — hidden from assistive tech. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "opacity .45s ease",
          opacity: sceneReady ? 0 : 1,
          pointerEvents: sceneReady ? "none" : undefined,
        }}
      >
        <PuzzlePlank boxes={boxes} />
      </div>

      {showScene && (
        <SceneBoundary onError={() => setSceneReady(false)}>
          <React.Suspense fallback={null}>
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                // Physics scene needs pointer events for drag; static scene
                // uses "none" so the surrounding page still scrolls freely.
                pointerEvents: usePhysics ? "auto" : "none",
                transition: "opacity .45s ease",
                opacity: sceneReady ? 1 : 0,
              }}
            >
              {usePhysics ? (
                <PlankScenePhysics {...sceneProps} />
              ) : (
                <PlankScene {...sceneProps} />
              )}
            </div>
          </React.Suspense>
        </SceneBoundary>
      )}

      {/* Reset control: only in the interactive physics scene, once it's live.
          stopPropagation on pointer-down so the press isn't picked up by r3f as a
          box grab (the canvas listens on this container as its event source). */}
      {usePhysics && sceneReady && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setResetNonce((n) => n + 1)}
          className="absolute right-2 bottom-2 z-10 gap-1.5 shadow-sm"
        >
          <RotateCcw className="size-3.5" />
          {t("plankReset")}
        </Button>
      )}

      {/* TEMPORARY wood-grain tuning panel — remove once the look is dialed in. */}
      {showScene && sceneReady && (
        <WoodTweaksPanel value={woodParams} onChange={setWoodParams} />
      )}
    </div>
  );
}

// ——— TEMPORARY: wood-grain tweaks panel ———
// A throwaway on-screen control surface so the wood-grain parameters can be
// dialed in live in the browser. Once a good combination is found, update
// DEFAULT_WOOD_PARAMS in wood-texture.ts and delete this component + its state.
const WOOD_SLIDERS: Array<{
  key: keyof WoodParams;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: "grains", label: "Grains", min: 2, max: 28, step: 1 },
  { key: "lineStrength", label: "Line", min: 0, max: 0.6, step: 0.01 },
  { key: "streakStrength", label: "Streak", min: 0, max: 0.5, step: 0.01 },
  { key: "toneStrength", label: "Tone", min: 0, max: 0.4, step: 0.01 },
  { key: "warp", label: "Warp", min: 0, max: 0.25, step: 0.005 },
  { key: "roughness", label: "Rough", min: 0.1, max: 1, step: 0.02 },
];

function WoodTweaksPanel({
  value,
  onChange,
}: {
  value: WoodParams;
  onChange: (next: WoodParams) => void;
}) {
  const [open, setOpen] = React.useState(false);
  // Don't let presses inside the panel reach the r3f canvas (box grabs).
  const stop = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <div
      onPointerDown={stop}
      style={{
        position: "absolute",
        top: 8,
        left: 8,
        zIndex: 20,
        fontFamily: "ui-monospace, monospace",
        fontSize: 11,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "rgba(20,18,42,0.85)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 6,
          padding: "4px 8px",
          cursor: "pointer",
        }}
      >
        🪵 Wood {open ? "▲" : "▼"}
      </button>

      {open && (
        <div
          style={{
            marginTop: 6,
            width: 220,
            background: "rgba(20,18,42,0.92)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 8,
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            backdropFilter: "blur(4px)",
          }}
        >
          {WOOD_SLIDERS.map((s) => (
            <label
              key={s.key}
              style={{ display: "flex", flexDirection: "column", gap: 2 }}
            >
              <span
                style={{ display: "flex", justifyContent: "space-between" }}
              >
                <span>{s.label}</span>
                <span style={{ opacity: 0.8 }}>
                  {Math.round(value[s.key] * 1000) / 1000}
                </span>
              </span>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={value[s.key]}
                onChange={(e) =>
                  onChange({ ...value, [s.key]: Number(e.target.value) })
                }
                style={{ width: "100%" }}
              />
            </label>
          ))}

          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => onChange(DEFAULT_WOOD_PARAMS)}
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.12)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6,
                padding: "4px 6px",
                cursor: "pointer",
              }}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard?.writeText(JSON.stringify(value))
              }
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.12)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6,
                padding: "4px 6px",
                cursor: "pointer",
              }}
            >
              Copy
            </button>
          </div>

          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              opacity: 0.85,
              fontSize: 10,
            }}
          >
            {JSON.stringify(value)}
          </pre>
        </div>
      )}
    </div>
  );
}

"use client";

import {
  PuzzlePlank,
  type PuzzlePlankBox,
} from "@/components/common/puzzle-plank";
import {
  resolveCssColor,
  resolveHeadingFont,
} from "@/components/marketing/plank-3d/palette";
import { useTheme } from "next-themes";
import * as React from "react";
import type { PlankSceneProps } from "./scene";

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
  };

  return (
    <div
      ref={container}
      style={{ position: "relative", width: "100%", height: "100%" }}
      aria-hidden="true"
    >
      {/* CSS plank: fallback shown until the scene's first frame, or permanently
          when WebGL is unavailable or the scene boundary catches an error. */}
      <div
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
    </div>
  );
}

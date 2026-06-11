import { JigPlank, type PlankBox } from "@/components/marketing/plank";
import { useTheme } from "next-themes";
import * as React from "react";
import { resolveCssColor, resolveHeadingFont } from "./palette";
import type { SceneProps } from "./scene";

const PlankScene = React.lazy(() => import("./scene"));

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

export function JigPlank3D({
  boxes = [],
  preset = "side",
}: {
  boxes?: PlankBox[];
  preset?: SceneProps["preset"];
}) {
  const container = React.useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false);
  const [sceneReady, setSceneReady] = React.useState(false);
  const [visible, setVisible] = React.useState(true);
  const [resolved, setResolved] = React.useState<SceneProps["resolved"] | null>(
    null,
  );
  const [headingFont, setHeadingFont] = React.useState("system-ui, sans-serif");
  const reducedMotion = usePrefersReducedMotion();
  const { resolvedTheme } = useTheme();
  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";

  React.useEffect(() => {
    setMounted(supportsWebGL());
  }, []);

  // Resolve CSS-var colors + font from the live DOM; re-resolve when the
  // theme flips (the whole --mk-* ramp changes under .dark).
  React.useEffect(() => {
    const el = container.current;
    if (!el || !mounted) return;
    setResolved(
      boxes.map((b) => ({
        c1: resolveCssColor(b.c1 ?? "var(--mk-violet-400)", el),
        c2: resolveCssColor(b.c2 ?? "var(--mk-violet-600)", el),
      })),
    );
    setHeadingFont(resolveHeadingFont(el));
  }, [boxes, mounted, theme]);

  // Pause the render loop when the hero is offscreen.
  React.useEffect(() => {
    const el = container.current;
    if (!el || !mounted) return;
    const io = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted]);

  const showScene = mounted && resolved !== null;

  return (
    <div
      ref={container}
      style={{ position: "relative", touchAction: "pan-y" }}
      aria-hidden="true"
    >
      {/* static ambient shadow so the plank pops off the page; CSS-only, no per-frame cost */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-12%",
          right: "-12%",
          bottom: -26,
          height: 64,
          background:
            "radial-gradient(50% 100% at 50% 0%, rgb(40 30 80 / 0.28), transparent 70%)",
          filter: "blur(6px)",
          pointerEvents: "none",
        }}
      />
      {/* CSS plank: defines layout size; stays as fallback until the scene
          has rendered a frame, then fades out (kept for layout). */}
      <div
        style={{
          transition: "opacity .45s ease",
          opacity: sceneReady ? 0 : 1,
          filter: "drop-shadow(0 30px 40px rgb(40 30 80 / .16))",
        }}
      >
        <JigPlank boxes={boxes} depth={18} />
      </div>
      {showScene && (
        <SceneBoundary onError={() => setSceneReady(false)}>
          <React.Suspense fallback={null}>
            {/* Bleed past the plank so lifted/dragged boxes aren't clipped.
                pointer-events: none on the canvas; interaction routes via
                eventSource={container}. */}
            <div
              style={{
                position: "absolute",
                top: -130,
                left: -70,
                right: -70,
                bottom: -40,
                pointerEvents: "none",
                transition: "opacity .45s ease",
                opacity: sceneReady ? 1 : 0,
              }}
            >
              <PlankScene
                boxes={boxes}
                resolved={resolved}
                headingFont={headingFont}
                theme={theme}
                reducedMotion={reducedMotion}
                visible={visible}
                preset={preset}
                onFirstFrame={() => setSceneReady(true)}
                eventSource={container}
              />
            </div>
          </React.Suspense>
        </SceneBoundary>
      )}
    </div>
  );
}

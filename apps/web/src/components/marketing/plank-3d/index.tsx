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

export function JigPlank3D({ rows = [] }: { rows?: PlankBox[][] }) {
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
      rows.map((row) =>
        row.map((b) => ({
          c1: resolveCssColor(b.c1 ?? "var(--mk-violet-400)", el),
          c2: resolveCssColor(b.c2 ?? "var(--mk-violet-600)", el),
        })),
      ),
    );
    setHeadingFont(resolveHeadingFont(el));
  }, [rows, mounted, theme]);

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
      style={{ position: "absolute", inset: 0, touchAction: "pan-y" }}
      aria-hidden="true"
    >
      {/* CSS planks: fallback shown pre-crossfade or when WebGL is
          unavailable. Two stacked boards echo the 3D multi-row shelf; the
          whole stack is scaled down so the boxes read smaller, matching the
          scene. Other JigPlank call sites (features/about) are untouched —
          the stacking lives here, not in JigPlank itself.
          Positioned right-of-center, vertically centered. */}
      <div
        style={{
          position: "absolute",
          right: "6%",
          top: "50%",
          transform: "translateY(-50%) scale(.68)",
          transition: "opacity .45s ease",
          opacity: sceneReady ? 0 : 1,
          filter: "drop-shadow(0 30px 40px rgb(40 30 80 / .16))",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 46,
        }}
      >
        {rows.length > 1 && (
          // Top board: slight x-shift so columns don't grid-align with the
          // bottom board, mirroring the 3D rows' per-row offsets.
          <JigPlank
            boxes={rows[1]}
            depth={14}
            style={{ transform: "translateX(-26px)" }}
          />
        )}
        <JigPlank boxes={rows[0] ?? []} depth={14} />
      </div>
      {showScene && (
        <SceneBoundary onError={() => setSceneReady(false)}>
          <React.Suspense fallback={null}>
            {/* Canvas fills the full container (the hero backdrop). */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                transition: "opacity .45s ease",
                opacity: sceneReady ? 1 : 0,
              }}
            >
              <PlankScene
                rows={rows}
                resolved={resolved}
                headingFont={headingFont}
                theme={theme}
                reducedMotion={reducedMotion}
                visible={visible}
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

import { useCanLoad3D } from "@/components/common/three-gate";
import { JigPlank, type PlankBox } from "@/components/marketing/plank";
import { useTheme } from "next-themes";
import * as React from "react";
import { resolveCssColor, resolveHeadingFont } from "./palette";
import type { SceneProps } from "./scene";

const PlankScene = React.lazy(() => import("./scene"));

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/** Render-nothing error boundary: any 3D failure leaves the hero as a closed gate does. */
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
  const [sceneReady, setSceneReady] = React.useState(false);
  const [visible, setVisible] = React.useState(true);
  const [resolved, setResolved] = React.useState<SceneProps["resolved"] | null>(
    null,
  );
  const [headingFont, setHeadingFont] = React.useState("system-ui, sans-serif");
  // `mounted` = idle client on a capable device (see three-gate); gates every
  // 3D path. Without it this backdrop shows the CSS planks from 1200px and no
  // art below that (phones get theirs in the page flow, see hero.tsx).
  const mounted = useCanLoad3D();
  const reducedMotion = usePrefersReducedMotion();
  const { resolvedTheme } = useTheme();
  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";
  // The gate can close again (viewport narrowed below 768 px): the scene
  // unmounts, so the CSS planks must not stay faded out for when it widens again.
  if (sceneReady && !mounted) setSceneReady(false);

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
          Positioned right-of-center, vertically centered. Below 1200px a row of
          three boxes reaches under the hero's frosted panel, which ends at
          x=664, and blurs into smudges behind the copy (it clears from about
          1175px; the first paint and a full catalogue both have such a row), so
          narrower screens get the scene or no art here. */}
      <div
        className="flex max-[1199px]:hidden"
        style={{
          position: "absolute",
          right: "6%",
          top: "50%",
          transform: "translateY(-50%) scale(.68)",
          transition: "opacity .45s ease",
          opacity: sceneReady ? 0 : 1,
          filter: "drop-shadow(0 30px 40px rgb(40 30 80 / .16))",
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

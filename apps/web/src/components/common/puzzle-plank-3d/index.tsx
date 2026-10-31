"use client";

import {
  PuzzlePlank,
  type PuzzlePlankBox,
} from "@/components/common/puzzle-plank";
import {
  supportsWebGL,
  useCanLoad3D,
  useDeviceAllows3D,
} from "@/components/common/three-gate";
import {
  resolveCssColor,
  resolveHeadingFont,
} from "@/components/marketing/plank-3d/palette";
import { Button } from "@/components/ui/button";
import { Hand, Loader2, RotateCcw } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { useTranslations } from "use-intl";
import { fallbackScale } from "./fallback-scale";
import type { PlankSceneProps } from "./scene";

const PlankScene = React.lazy(() => import("./scene"));
const PlankScenePhysics = React.lazy(() => import("./scene-physics"));

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
   * When true, offers the rapier physics scene (grab/drag/throw) behind a Play
   * button, or a first mouse press on the shelf; until then the static scene
   * (or the CSS plank) shows. Not offered on Save-Data or low-memory devices
   * or with prefers-reduced-motion, and dropped if WebGL turns out to be
   * missing. Defaults to false (dashboard shelf).
   */
  interactive?: boolean;
}) {
  const container = React.useRef<HTMLDivElement>(null);
  const fallbackLayer = React.useRef<HTMLDivElement>(null);
  const fallbackPlank = React.useRef<HTMLDivElement>(null);
  const [fallbackFit, setFallbackFit] = React.useState(1);
  const [sceneReady, setSceneReady] = React.useState(false);
  const [visible, setVisible] = React.useState(true);
  const [resolved, setResolved] = React.useState<
    PlankSceneProps["resolved"] | null
  >(null);
  const [headingFont, setHeadingFont] = React.useState("system-ui, sans-serif");
  // Bumped by the Reset button to snap the physics boxes back to their layout.
  const [resetNonce, setResetNonce] = React.useState(0);
  // The physics chunk (rapier + WASM, ~845 KB gz) loads only when asked for.
  const [physicsRequested, setPhysicsRequested] = React.useState(false);
  const [physicsReady, setPhysicsReady] = React.useState(false);
  const [physicsFailed, setPhysicsFailed] = React.useState(false);
  // Set once the static scene has faded out under the live physics scene.
  const [staticRetired, setStaticRetired] = React.useState(false);
  const t = useTranslations("shell");
  // Idle client on a capable device (see three-gate); gates the static scene.
  // Otherwise the CSS plank stays.
  const canLoad3D = useCanLoad3D();
  const deviceAllows3D = useDeviceAllows3D();
  const reducedMotion = usePrefersReducedMotion();
  const { resolvedTheme } = useTheme();
  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";

  // Physics is offered on any device the 3D gate's device budget allows
  // (Save-Data and low memory never get it), phones included, where only an
  // explicit Play loads it; never with reduced motion. WebGL is probed only
  // once physics is asked for, so a phone that never asks allocates no GL
  // context; without WebGL the request falls back to the CSS plank.
  const canPlay =
    interactive && deviceAllows3D && !reducedMotion && !physicsFailed;
  const physicsOn = canPlay && physicsRequested;
  const requestPhysics = () => {
    if (supportsWebGL()) setPhysicsRequested(true);
    else setPhysicsFailed(true);
  };
  // The static scene stays until physics has painted and faded in over it; if
  // it never painted itself there is nothing to crossfade from.
  const showStatic =
    canLoad3D && !(physicsOn && physicsReady && (staticRetired || !sceneReady));
  const mounted = showStatic || physicsOn;
  // A scene that unmounts (gate closed, physics failed) must not leave the
  // CSS plank faded out.
  if (sceneReady && !showStatic) setSceneReady(false);
  if (physicsReady && !physicsOn) setPhysicsReady(false);

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

  // Shrink the CSS plank to fit its container: a full shelf is wider than a
  // phone or tablet column. Measured in the observer callback only.
  const hasBoxes = boxes.length > 0;
  React.useEffect(() => {
    const layer = fallbackLayer.current;
    const plank = fallbackPlank.current;
    if (!layer || !plank) return;
    const ro = new ResizeObserver(() =>
      setFallbackFit(fallbackScale(layer.clientWidth, plank.offsetWidth)),
    );
    ro.observe(layer);
    ro.observe(plank);
    return () => ro.disconnect();
  }, [hasBoxes]);

  // Empty boxes → nothing to render.
  if (!hasBoxes) return null;

  const physicsLoading = physicsOn && !physicsReady;

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
  };

  return (
    <div
      ref={container}
      style={{ position: "relative", width: "100%", height: "100%" }}
      // A mouse press on the shelf asks for physics too. Touch never does, so
      // scrolling past the shelf on a phone or tablet loads nothing.
      onPointerDown={(e) => {
        if (canPlay && !physicsRequested && e.pointerType === "mouse")
          requestPhysics();
      }}
    >
      {/* CSS plank: fallback shown until a scene's first frame, or permanently
          when 3D is gated off, WebGL is unavailable or a scene boundary catches
          an error. Clipped and scaled to its container so it never overflows the
          page, even once faded out. Decorative — hidden from assistive tech. */}
      <div
        ref={fallbackLayer}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "opacity .45s ease",
          opacity: sceneReady || physicsReady ? 0 : 1,
          pointerEvents: sceneReady || physicsReady ? "none" : undefined,
        }}
      >
        <div
          ref={fallbackPlank}
          style={{ flexShrink: 0, transform: `scale(${fallbackFit})` }}
        >
          <PuzzlePlank boxes={boxes} />
        </div>
      </div>

      {showStatic && resolved !== null && (
        <SceneBoundary onError={() => setSceneReady(false)}>
          <React.Suspense fallback={null}>
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                // "none" so the surrounding page still scrolls freely.
                pointerEvents: "none",
                transition: "opacity .45s ease",
                opacity: sceneReady && !physicsReady ? 1 : 0,
              }}
              onTransitionEnd={(e) => {
                if (physicsReady && e.target === e.currentTarget)
                  setStaticRetired(true);
              }}
            >
              <PlankScene
                {...sceneProps}
                // Frozen while it fades out under the physics scene.
                visible={visible && !physicsReady}
                // Same board width as the physics scene, so the swap is seamless.
                wideShelf={interactive}
              />
            </div>
          </React.Suspense>
        </SceneBoundary>
      )}

      {/* Own boundary: while rapier's WASM loads, the physics canvas suspends,
          and that must not hide the static scene underneath. */}
      {physicsOn && resolved !== null && (
        <SceneBoundary onError={() => setPhysicsFailed(true)}>
          <React.Suspense fallback={null}>
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                // The physics scene needs pointer events for drag.
                pointerEvents: "auto",
                transition: "opacity .45s ease",
                opacity: physicsReady ? 1 : 0,
              }}
            >
              <PlankScenePhysics
                {...sceneProps}
                onFirstFrame={() => setPhysicsReady(true)}
              />
            </div>
          </React.Suspense>
        </SceneBoundary>
      )}

      {/* Play, then Reset once physics is live: one button, so keyboard focus
          stays put when it switches. stopPropagation on pointer-down so the
          press isn't picked up by r3f as a box grab (the canvas listens on this
          container as its event source). */}
      {canPlay && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-disabled={physicsLoading || undefined}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            if (physicsReady) setResetNonce((n) => n + 1);
            else requestPhysics();
          }}
          className="absolute right-2 bottom-2 z-10 gap-1.5 shadow-sm"
        >
          {physicsReady ? (
            <RotateCcw className="size-3.5" />
          ) : physicsLoading ? (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Hand className="size-3.5" />
          )}
          {physicsReady ? t("plankReset") : t("plankPlay")}
        </Button>
      )}
    </div>
  );
}

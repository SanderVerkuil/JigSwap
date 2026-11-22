"use client";

import { Link } from "@/compat/link";
import {
  supportsWebGL,
  useDeviceAllows3D,
} from "@/components/common/three-gate";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Hand, Loader2, RotateCcw } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { useFormatter, useTranslations } from "use-intl";
import { BoxFace, lidColor, ShelfLedge, type ShelfBox } from "./box-face";
import { boxScale, shelfRowVars } from "./box-size";
import { measurePlayLayout, type PlayLayout } from "./play-layout";

// For the pages that stand an empty shelf on the ledge.
export { ShelfLedge } from "./box-face";

// The shelf: one row of puzzle boxes standing on a plank-tan ledge, the same object wherever
// JigSwap shows somebody's boxes (DESIGN.md, Shelf). Flat at rest on every device; Play lifts this
// same row into 3D where it stands (play-scene.tsx, loaded only then).

const PlayScene = React.lazy(() => import("./play-scene"));

// Lifts 3px off the ledge under a pointer (the house's strong ease-out), presses like a button.
const BOX_LINK =
  "block origin-bottom rounded-t-[2px] transition-[translate,scale,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-safe:hover:-translate-y-[3px] motion-safe:hover:shadow-[0_7px_8px_-5px_rgb(0_0_0/0.35)] motion-safe:active:scale-[0.97]";

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

/** Render-nothing error boundary: a scene that fails leaves the flat row. */
class SceneBoundary extends React.Component<
  { children: React.ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// rest: the flat row. loading: the scene is loading behind it. playing: the scene shows. returning:
// the boxes glide home and the view flattens. settling: the row fades back in over the matching
// scene, which then goes.
type PlayState = "rest" | "loading" | "playing" | "returning" | "settling";

export interface ShelfProps {
  boxes: ShelfBox[];
  /** Names the row for assistive tech, e.g. "Your shelf". */
  label: string;
  /** Offer Play (3D, grab and throw), where the device allows it. */
  play?: boolean;
  className?: string;
}

export function Shelf({ boxes, label, play = true, className }: ShelfProps) {
  const t = useTranslations("shell");
  const format = useFormatter();
  const stage = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<PlayState>("rest");
  const [layout, setLayout] = React.useState<PlayLayout | null>(null);
  const [returnNonce, setReturnNonce] = React.useState(0);
  const [failed, setFailed] = React.useState(false);
  const [visible, setVisible] = React.useState(true);

  // Play needs a device that may run 3D (no Save-Data or low memory), and never moves anything for
  // someone who asked for less motion. WebGL is probed only once Play is pressed.
  const deviceAllows3D = useDeviceAllows3D();
  const reducedMotion = usePrefersReducedMotion();
  const canPlay =
    play && deviceAllows3D && !reducedMotion && !failed && boxes.length > 0;
  const { resolvedTheme } = useTheme();
  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";

  const scales = boxes.map((box) => boxScale(box.pieceCount));
  const atRest = state === "rest";

  // Back to the flat row. The return count goes back to zero too, or the next game's scene would
  // read the last Reset as its own and close itself on mount.
  const stop = React.useCallback(() => {
    setState("rest");
    setLayout(null);
    setReturnNonce(0);
  }, []);
  // Reduced motion turned on mid-game (or Play otherwise withdrawn) takes Reset away with it: back
  // to the flat row at once, without the glide. Adjusted during render, not in an effect.
  if (!canPlay && !atRest) stop();

  const start = () => {
    const el = stage.current;
    if (!el) return;
    if (!supportsWebGL()) {
      setFailed(true);
      return;
    }
    setLayout(
      measurePlayLayout(
        el,
        boxes.map((box, i) => ({
          cover: box.cover,
          lid: {
            color: lidColor(i),
            title: box.title,
            brand: box.brand,
            pieces:
              box.pieceCount != null
                ? format.number(box.pieceCount)
                : undefined,
          },
        })),
      ),
    );
    setState("loading");
  };

  // The scene drew what was measured: a new theme or a resized row ends the game at once.
  const playingTheme = React.useRef(theme);
  React.useEffect(() => {
    if (atRest) playingTheme.current = theme;
    else if (playingTheme.current !== theme) stop();
  }, [atRest, theme, stop]);
  React.useEffect(() => {
    const el = stage.current;
    if (atRest || !el) return;
    const width = el.offsetWidth;
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth !== width) stop();
    });
    ro.observe(el);
    // No frames and no physics while the shelf is out of view.
    const io = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, [atRest, stop]);

  // The row fades back in over the flat scene, then the scene goes.
  React.useEffect(() => {
    if (state !== "settling") return;
    const id = window.setTimeout(stop, 160);
    return () => window.clearTimeout(id);
  }, [state, stop]);

  const sceneShown = state === "playing" || state === "returning";

  return (
    <div className={cn("relative", className)}>
      <div ref={stage} className="relative -mx-1">
        {/* The row shares its width between the boxes and only scrolls when they would get
            smaller than a 1,000-piece box's minimum. The padding is room for the hover lift and
            focus rings, which a scroller clips; the ledge scrolls with the boxes, its bar under
            it. */}
        <div
          inert={sceneShown}
          className="@container overflow-x-auto overscroll-x-contain px-1 pt-2 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ opacity: sceneShown ? 0 : 1 }}
        >
          <div className="w-max min-w-full">
            <ul
              aria-label={label}
              style={shelfRowVars(scales)}
              className="flex h-(--row-h) items-end gap-3.5"
            >
              {boxes.map((box, i) => (
                <li
                  key={box.id}
                  style={{ "--scale": scales[i] } as React.CSSProperties}
                  className="flex shrink-0"
                >
                  {box.href ? (
                    <Link
                      href={box.href}
                      aria-label={box.title}
                      className={BOX_LINK}
                    >
                      <BoxFace box={box} index={i} named={false} />
                    </Link>
                  ) : (
                    <BoxFace box={box} index={i} named />
                  )}
                </li>
              ))}
            </ul>
            <ShelfLedge data-shelf-ledge="" />
          </div>
        </div>

        {layout && state !== "rest" && (
          <SceneBoundary
            onError={() => {
              setFailed(true);
              stop();
            }}
          >
            <React.Suspense fallback={null}>
              {/* Decorative: the row underneath keeps the boxes' names. The scene takes no clicks
                  or focus until it shows: inert, as R3F's canvas wrapper sets its own
                  pointer-events: auto, which a class on this layer wouldn't beat. */}
              <div
                aria-hidden="true"
                inert={!sceneShown}
                className="absolute inset-0"
              >
                <PlayScene
                  layout={layout}
                  theme={theme}
                  visible={visible}
                  returnNonce={returnNonce}
                  onFirstFrame={() =>
                    setState((s) => (s === "loading" ? "playing" : s))
                  }
                  onReturned={() => setState("settling")}
                />
              </div>
            </React.Suspense>
          </SceneBoundary>
        )}
      </div>

      {canPlay && (
        <div className="mt-0.5 flex justify-end">
          {/* One button, so focus stays put when Play becomes Reset. Named for what it acts on,
              since the 3D shelf is hidden from assistive tech (and keeps the visible word, for
              voice control). */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={
              atRest || state === "loading"
                ? t("plankPlayLabel")
                : t("plankResetLabel")
            }
            aria-disabled={
              (state !== "rest" && state !== "playing") || undefined
            }
            onClick={() => {
              if (state === "rest") start();
              else if (state === "playing") {
                setReturnNonce((n) => n + 1);
                setState("returning");
              }
            }}
            className="text-muted-foreground hover:text-foreground h-7 gap-1 px-2 text-xs"
          >
            {state === "loading" ? (
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            ) : atRest ? (
              <Hand className="size-3.5" />
            ) : (
              <RotateCcw className="size-3.5" />
            )}
            {atRest || state === "loading" ? t("plankPlay") : t("plankReset")}
          </Button>
        </div>
      )}
    </div>
  );
}

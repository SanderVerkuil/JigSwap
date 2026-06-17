import { PieceMotif } from "@/components/marketing/piece-motif";
import * as React from "react";

// The signature jigsaw path, mirrored from PieceMotif so we can render it at an
// arbitrary box size (filled for the snapped piece, stroked for the notch).
const PIECE_PATH = [
  "M 28 22",
  "H 42",
  "A 11 11 0 1 1 58 22",
  "H 72",
  "Q 78 22 78 28",
  "V 42",
  "A 11 11 0 1 1 78 58",
  "V 72",
  "Q 78 78 72 78",
  "H 58",
  "A 11 11 0 1 0 42 78",
  "H 28",
  "Q 22 78 22 72",
  "V 28",
  "Q 22 22 28 22",
  "Z",
].join(" ");

// Square SVG that fills its (notch-sized) container.
function PieceSquare({
  fill,
  stroke,
  dashed = false,
}: {
  fill: string;
  stroke?: string;
  dashed?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      width="100%"
      height="100%"
      style={{ display: "block", overflow: "visible" }}
    >
      <path
        d={PIECE_PATH}
        fill={fill}
        stroke={stroke}
        strokeWidth={dashed ? 4 : 0}
        strokeDasharray={dashed ? "7 6" : undefined}
        strokeLinejoin="round"
      />
    </svg>
  );
}

type Confetti = {
  id: number;
  color: string;
  vx: number;
  vy: number;
  vr: string;
};

const CONFETTI_COLORS = [
  "var(--mk-violet-400)",
  "var(--mk-green-400)",
  "var(--mk-pink-400)",
  "var(--mk-violet-600)",
];

function makeConfetti(): Confetti[] {
  // 3–4 minis popping outward ~40–60px in an upward fan.
  const spread = [-118, -54, 28, 96];
  return spread.map((deg, i) => {
    const angle = (deg * Math.PI) / 180;
    const dist = 44 + Math.random() * 16;
    return {
      id: i,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      vx: Math.cos(angle) * dist,
      vy: Math.sin(angle) * dist,
      vr: `${i % 2 === 0 ? "" : "-"}${120 + i * 30}deg`,
    };
  });
}

type PieceState = {
  interactive: boolean;
  placed: boolean;
  dragging: boolean;
  animateSnap: boolean;
  confetti: Confetti[];
  showToast: boolean;
  targetRef: React.RefObject<HTMLSpanElement | null>;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

// All the delight-moment state. Shared between the inline notch (lives in the
// <h1>) and the tray/caption/toast (a block under the headline) so the headline
// text flow stays clean.
function usePieceState(onPlaced?: () => void): PieceState {
  // Server + first client paint: pre-snapped, no tray (the safe, legible
  // fallback). After hydration, if motion is allowed, flip to interactive.
  const [interactive, setInteractive] = React.useState(false);
  const [placed, setPlaced] = React.useState(true);
  const [dragging, setDragging] = React.useState(false);
  const [confetti, setConfetti] = React.useState<Confetti[]>([]);
  const [showToast, setShowToast] = React.useState(false);
  const [animateSnap, setAnimateSnap] = React.useState(false);
  const targetRef = React.useRef<HTMLSpanElement | null>(null);
  const firedRef = React.useRef(false);

  React.useEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!reduced) {
      setInteractive(true);
      setPlaced(false);
    }
  }, []);

  const place = React.useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    setAnimateSnap(true);
    setPlaced(true);
    setDragging(false);
    setConfetti(makeConfetti());
    setShowToast(true);
    onPlaced?.();
    window.setTimeout(() => setConfetti([]), 900);
    window.setTimeout(() => setShowToast(false), 2100);
  }, [onPlaced]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (placed) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDragging(true);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (placed || !dragging) return;
    const target = targetRef.current?.getBoundingClientRect();
    if (target) {
      const cx = target.left + target.width / 2;
      const cy = target.top + target.height / 2;
      const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
      if (dist < 160) {
        place();
        return;
      }
    }
    setDragging(false); // bounce back to the tray
  };
  const onPointerCancel = () => setDragging(false);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      place();
    }
  };

  return {
    interactive,
    placed,
    dragging,
    animateSnap,
    confetti,
    showToast,
    targetRef,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onKeyDown,
  };
}

/**
 * The headline word "puzzles" with the piece-shaped notch in the "z" slot.
 * Inline — drop it inside the <h1>. Screen readers read the intact word via a
 * visually-hidden copy; the visible glyphs render "pu␣zles" around the piece.
 */
function HeadlineNotch({ state }: { state: PieceState }) {
  const { placed, dragging, animateSnap, confetti, targetRef } = state;
  return (
    <span className="v-notch-word">
      <span className="sr-only">puzzles</span>
      <span aria-hidden="true">pu</span>
      <span
        ref={targetRef}
        aria-hidden="true"
        className="v-notch-target"
        data-dragging={dragging ? "true" : "false"}
        style={{
          position: "relative",
          display: "inline-block",
          width: "var(--v-notch)",
          height: "var(--v-notch)",
          top: "auto",
          transform: "translateY(0.1em)",
          verticalAlign: "baseline",
          margin: "0 0.04em",
        }}
      >
        {placed ? (
          <span
            className="v-notch-fill"
            data-animate={animateSnap ? "true" : "false"}
            style={{
              position: "absolute",
              inset: 0,
              top: "auto",
              transform: "none",
            }}
          >
            <PieceSquare fill="var(--mk-violet-400)" />
          </span>
        ) : (
          <PieceSquare
            fill="color-mix(in oklab, var(--mk-violet-200) 35%, transparent)"
            stroke="var(--mk-violet-300)"
            dashed
          />
        )}
        {/* Confetti — fully contained, decorative. */}
        {confetti.map((c) => (
          <span
            key={c.id}
            className="v-confetti-piece"
            aria-hidden="true"
            style={
              {
                "--vx": `${c.vx}px`,
                "--vy": `${c.vy}px`,
                "--vr": c.vr,
              } as React.CSSProperties
            }
          >
            <PieceMotif size={16} color={c.color} />
          </span>
        ))}
      </span>
      <span aria-hidden="true">zles</span>
    </span>
  );
}

/**
 * The tray (draggable / keyboard button) + drag hint + success toast. Render
 * this as a block UNDER the headline so it never disrupts the h1 text flow.
 * Reserves a small min-height so the layout doesn't shift when it disappears.
 */
function PieceTray({ state }: { state: PieceState }) {
  const {
    interactive,
    placed,
    dragging,
    showToast,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onKeyDown,
  } = state;

  // Nothing to show once the moment is complete or in the static fallback.
  if (!interactive) return null;

  return (
    <div className="mt-4 flex min-h-[48px] flex-wrap items-center gap-2">
      {!placed && (
        <>
          <button
            type="button"
            className="v-tray-piece"
            data-dragging={dragging ? "true" : "false"}
            aria-label="Place the last puzzle piece"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onKeyDown={onKeyDown}
            style={{ minWidth: 44, minHeight: 44 }}
          >
            <span className="v-tray-piece-art">
              <PieceMotif size={30} color="var(--mk-violet-400)" />
            </span>
          </button>
          <span className="text-[13px] font-medium text-mk-text-muted select-none">
            Pop the last piece in →
          </span>
        </>
      )}
      {showToast && (
        <span
          role="status"
          className="v-success-toast text-[14px] font-semibold text-mk-violet-600"
        >
          Nice — that&apos;s the spirit 🧩
        </span>
      )}
    </div>
  );
}

/**
 * The entire hero delight moment. Returns the two render slots — `notch` (drop
 * inside the <h1>) and `tray` (drop directly under the <h1>) — plus shares the
 * one-time `onPlaced` tick. Reduced-motion / no-JS degrade to the piece already
 * snapped in place: no tray, no caption, no confetti, headline fully legible.
 */
export function useDraggablePiece(onPlaced?: () => void): {
  notch: React.ReactNode;
  tray: React.ReactNode;
} {
  const state = usePieceState(onPlaced);
  return {
    notch: <HeadlineNotch state={state} />,
    tray: <PieceTray state={state} />,
  };
}

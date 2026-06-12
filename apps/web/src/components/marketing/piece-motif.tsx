import * as React from "react";

// A proper jigsaw piece: 56×56 body (22..78) with rounded corners, a knob on
// the top and right edges, a socket cut into the bottom edge, and a flat left
// edge — knobs/sockets are >180° arcs (r=11, neck 16) so they read as real
// tabs-and-blanks.
const PIECE_PATH = [
  "M 28 22",
  "H 42",
  "A 11 11 0 1 1 58 22", // top knob (bulges up)
  "H 72",
  "Q 78 22 78 28",
  "V 42",
  "A 11 11 0 1 1 78 58", // right knob (bulges out)
  "V 72",
  "Q 78 78 72 78",
  "H 58",
  "A 11 11 0 1 0 42 78", // bottom socket (cuts into the body)
  "H 28",
  "Q 22 78 22 72",
  "V 28",
  "Q 22 22 28 22",
  "Z",
].join(" ");

// Decorative floating jigsaw-piece silhouette used behind heros and bands.
export function PieceMotif({
  size = 64,
  color = "var(--mk-violet-200)",
  rotate = 0,
  className,
  style,
}: {
  size?: number;
  color?: string;
  rotate?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      className={className}
      style={{ transform: `rotate(${rotate}deg)`, ...style }}
    >
      <path fill={color} d={PIECE_PATH} />
    </svg>
  );
}

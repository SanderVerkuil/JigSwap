import * as React from "react";

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
      <path
        fill={color}
        d="M37 8a8 8 0 0116 0c0 2-1 4-1 6 0 3 3 5 6 5s5-3 6-5 4-3 6-2a8 8 0 010 16c-2 0-4-1-6-1-3 0-5 2-5 5s2 5 5 6c2 0 4 0 5 1a8 8 0 01-2 15 8 8 0 01-9-6c0-2 1-4 1-6 0-3-3-5-6-5h-1c-3 0-5 3-5 6 0 2 1 4 1 6a8 8 0 01-16 0c0-2 1-4 1-6 0-3-2-5-5-5s-5 2-6 5-4 3-6 2A8 8 0 016 53c2 0 4 1 6 1 3 0 5-2 5-5s-2-5-5-6c-2 0-4 0-6-1A8 8 0 0114 27a8 8 0 019 6c0 2-1 4-1 6 0 3 3 5 6 5s5-3 5-6c0-2-1-4-1-6 0-3 2-5 5-5z"
      />
    </svg>
  );
}

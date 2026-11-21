"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import { useFormatter } from "use-intl";

// The shelf's parts, without its 3D: a box (its cover, or a painted lid) and the ledge it stands
// on. The app's shelves stand them in a row (shelf.tsx); the public catalogue and the home hero's
// drawer stand them in their own layouts, so every shelf on the site is the same object.

export interface ShelfBox {
  /** Stable key: the copy's id. */
  id: string;
  title: string;
  brand?: string;
  pieceCount?: number;
  /** The box art. Without one (or when it fails to load) the box is a painted lid. */
  cover?: string;
  /** Where the box opens. Without one the box is a picture, named by its title. */
  href?: string;
}

// Street colours for a box without a cover. White text is at least 4.5:1 on each.
export const LID_COLORS = ["#146350", "#a86400", "#2b7bb9", "#c8321f"] as const;

export function lidColor(index: number): string {
  return LID_COLORS[index % LID_COLORS.length];
}

/** The tan ledge boxes stand on: square ends, the full width of its row. */
export function ShelfLedge({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      {...props}
      className={cn("bg-mk-plank h-[9px]", className)}
    />
  );
}

// A box without art: a flat lid in a street colour, lettered like the real thing.
function PaintedLid({
  box,
  color,
  className,
}: {
  box: ShelfBox;
  color: string;
  className?: string;
}) {
  const format = useFormatter();
  return (
    // The lid is the container its lettering sizes from; the padding sits inside it, because an
    // element's own cqw units measure the container around it (the whole row), not itself.
    <span
      data-shelf-box=""
      className={cn(
        "@container/lid block aspect-[4/3] overflow-hidden rounded-t-[2px] text-white",
        className,
      )}
      style={{ backgroundColor: color }}
    >
      <span className="flex h-full flex-col justify-between gap-1 p-[7cqw]">
        {box.brand && (
          <span className="truncate text-[max(10px,8cqw)] leading-tight">
            {box.brand}
          </span>
        )}
        <span className="font-heading line-clamp-3 text-[max(12px,12cqw)] leading-[1.08] break-words hyphens-auto">
          {box.title}
        </span>
        {box.pieceCount != null && (
          <span className="figures self-end text-[max(10px,8cqw)] leading-none">
            {format.number(box.pieceCount)}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * A box's face: its cover standing at its own proportions, or a painted lid. Sized by the row
 * around it (`--unit`, `--row-h`) and its own `--scale`. `named` gives the picture the title as its
 * text alternative; a box inside a link leaves naming to the link.
 */
export function BoxFace({
  box,
  index,
  named,
  srcSet,
  sizes,
  priority,
  className,
}: {
  box: ShelfBox;
  index: number;
  named: boolean;
  /** Renditions, where the cover has them (the public pages' art and catalogue). */
  srcSet?: string;
  sizes?: string;
  /** Above the fold: fetch the cover eagerly, first. */
  priority?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  if (box.cover && !failed) {
    return (
      // Box art from the catalogue or the member's own photo: a 480px thumbnail covers an app
      // shelf's box at twice its size, so a plain <img>.
      <img
        data-shelf-box=""
        src={box.cover}
        srcSet={srcSet}
        sizes={srcSet ? sizes : undefined}
        alt={named ? box.title : ""}
        width={480}
        height={360}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        onError={() => setFailed(true)}
        className={cn(
          "bg-muted block h-auto max-h-(--row-h) w-auto max-w-[calc(var(--unit)*var(--scale))] rounded-t-[2px]",
          className,
        )}
      />
    );
  }
  return (
    <PaintedLid
      box={box}
      color={lidColor(index)}
      className={cn(
        "max-h-(--row-h) w-[calc(var(--unit)*var(--scale))]",
        className,
      )}
    />
  );
}

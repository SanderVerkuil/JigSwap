"use client";

import { cn } from "@/lib/utils";
import { Star } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "use-intl";

// A reusable 1–5 star control. Read-only by default (display); pass `onChange` to make it an
// interactive input. Kept generic (no domain coupling) because both PuzzleReviews and, later,
// reputation need stars.
//
// Interactive mode is a WAI-ARIA radio group with a roving tabindex: the whole row is ONE Tab
// stop (the chosen star, else the first), the arrow keys move and select (Right/Down = one more
// star, Left/Up = one fewer, clamped rather than wrapping), Home/End jump to one/five stars, and
// Delete/Backspace clear when `clearable`. Every star is at least a 32px hit area, 44px on touch
// screens, whatever the icon `size`.
interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  // Visual size of each star icon; matches Tailwind sizing used elsewhere.
  size?: "sm" | "md" | "lg";
  className?: string;
  // Accessible label for the group when interactive (e.g. "Rate this puzzle"); read-only mode
  // falls back to "N out of 5 stars".
  label?: string;
  // Interactive only: let Delete/Backspace take the rating back to 0 ("no rating").
  clearable?: boolean;
  // Interactive only: id of the element that describes the group (e.g. a "choose a rating" hint).
  describedBy?: string;
  // Interactive only: the surrounding form needs a rating (aria-required on the group).
  required?: boolean;
}

const SIZES = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
} as const;

// Interactive stars sit in a bigger hit area than their icon; pull the row left by the padding
// (half of 32px or 44px minus the icon) so the first icon still lines up with a label above it.
const HIT_AREA_OFFSET = {
  sm: "-ml-2 pointer-coarse:-ml-3.5",
  md: "-ml-1.5 pointer-coarse:-ml-3",
  lg: "-ml-1 pointer-coarse:-ml-2.5",
} as const;

const STARS = [1, 2, 3, 4, 5] as const;

const clampStar = (star: number) => Math.min(5, Math.max(1, star));

export function StarRating({
  value,
  onChange,
  size = "md",
  className,
  label,
  clearable = false,
  describedBy,
  required = false,
}: StarRatingProps) {
  const t = useTranslations("starRating");
  // Hover preview only matters in interactive mode; null means "show the committed value".
  const [hovered, setHovered] = useState<number | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const interactive = typeof onChange === "function";
  const shown = hovered ?? value;

  if (!interactive) {
    return (
      <div
        className={cn("flex items-center gap-0.5", className)}
        role="img"
        aria-label={label ?? t("outOf", { value })}
      >
        {STARS.map((star) => (
          <Star
            key={star}
            className={cn(
              SIZES[size],
              star <= value
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground/40",
            )}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  // The roving tab stop: the chosen star, or the first one while nothing is chosen.
  const tabStop = value >= 1 && value <= 5 ? value : 1;

  const select = (star: number) => {
    onChange(star);
    buttons.current[star - 1]?.focus();
  };

  const onKeyDown = (star: number, event: KeyboardEvent) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        select(clampStar(star + 1));
        break;
      case "ArrowLeft":
      case "ArrowUp":
        select(clampStar(star - 1));
        break;
      case "Home":
        select(1);
        break;
      case "End":
        select(5);
        break;
      case "Delete":
      case "Backspace":
        if (!clearable) return;
        onChange(0);
        // Keep focus on the tab stop, which is the first star again.
        buttons.current[0]?.focus();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div
      className={cn("flex items-center", HIT_AREA_OFFSET[size], className)}
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      aria-required={required || undefined}
    >
      {STARS.map((star) => (
        <button
          key={star}
          ref={(element) => {
            buttons.current[star - 1] = element;
          }}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={t("star", { count: star })}
          tabIndex={star === tabStop ? 0 : -1}
          onClick={() => onChange(star)}
          onKeyDown={(event) => onKeyDown(star, event)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(null)}
          className="group inline-flex size-8 shrink-0 items-center justify-center rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11"
        >
          <Star
            aria-hidden="true"
            className={cn(
              SIZES[size],
              "transition-transform group-hover:scale-110",
              star <= shown
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground/40",
            )}
          />
        </button>
      ))}
    </div>
  );
}

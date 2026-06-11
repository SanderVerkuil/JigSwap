"use client";

import { cn } from "@/lib/utils";
import { Star } from "lucide-react";
import { useState } from "react";

// A reusable 1–5 star control. Read-only by default (display); pass `onChange` to make it an
// interactive input. Kept generic (no domain coupling) because both PuzzleReviews and, later,
// reputation need stars.
interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  // Visual size of each star; matches Tailwind sizing used elsewhere.
  size?: "sm" | "md" | "lg";
  className?: string;
  // Accessible label for the group when interactive (e.g. "Rate this puzzle").
  label?: string;
}

const SIZES = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
} as const;

const STARS = [1, 2, 3, 4, 5] as const;

export function StarRating({
  value,
  onChange,
  size = "md",
  className,
  label,
}: StarRatingProps) {
  // Hover preview only matters in interactive mode; null means "show the committed value".
  const [hovered, setHovered] = useState<number | null>(null);
  const interactive = typeof onChange === "function";
  const shown = hovered ?? value;

  if (!interactive) {
    return (
      <div
        className={cn("flex items-center gap-0.5", className)}
        role="img"
        aria-label={label ?? `${value} out of 5 stars`}
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

  return (
    <div
      className={cn("flex items-center gap-0.5", className)}
      role="radiogroup"
      aria-label={label}
    >
      {STARS.map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} ${star === 1 ? "star" : "stars"}`}
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered(star)}
          onBlur={() => setHovered(null)}
          className="rounded-sm p-0.5 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Star
            className={cn(
              SIZES[size],
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

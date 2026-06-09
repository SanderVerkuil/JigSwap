"use client";

import { cn } from "@/lib/utils";
import { Star } from "lucide-react";

// Local 1-5 star control for the Reputation feature. Kept here (not components/ui) to avoid a
// collision with a shared StarRating a parallel agent may add under components/ui; the
// orchestrator can de-dup later. Interactive when `onChange` is supplied, read-only otherwise,
// so it doubles as both the review-form input and a compact rating display.
interface StarInputProps {
  value: number;
  onChange?: (value: number) => void;
  size?: "sm" | "md";
  label?: string;
  className?: string;
}

export function StarInput({
  value,
  onChange,
  size = "md",
  label,
  className,
}: StarInputProps) {
  const readOnly = !onChange;
  const px = size === "sm" ? "h-4 w-4" : "h-6 w-6";

  return (
    <div
      className={cn("flex items-center gap-0.5", className)}
      role={readOnly ? "img" : "radiogroup"}
      aria-label={label}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= value;
        const StarIcon = (
          <Star
            className={cn(
              px,
              "transition-colors",
              filled
                ? "fill-yellow-400 text-yellow-400"
                : "fill-transparent text-muted-foreground/40",
            )}
          />
        );

        if (readOnly) {
          return <span key={star}>{StarIcon}</span>;
        }

        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star}`}
            onClick={() => onChange(star)}
            className="rounded-sm p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {StarIcon}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Puzzle } from "lucide-react";
import type { ReactNode } from "react";

// Shared presentational pieces for the divider-led catalog detail pages
// (puzzle definition + copy instance). Extracted so the two pages stay visually
// identical without duplicating the gradient cover, avatars, section heads, etc.

// Difficulty colour swatch, matching the shared PuzzleCard / copy-instance scheme.
export function difficultyClasses(difficulty?: string) {
  switch (difficulty) {
    case "easy":
      return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200";
    case "medium":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200";
    case "hard":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200";
    case "expert":
      return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}

// The violet gradient + centered puzzle glyph used as the no-image cover
// fallback across the catalog detail pages.
export function PuzzleCoverFallback() {
  return (
    <div className="from-jigsaw-primary/20 to-jigsaw-primary text-jigsaw-primary-foreground/70 absolute inset-0 flex items-center justify-center bg-gradient-to-br">
      <Puzzle className="h-1/3 w-1/3" />
    </div>
  );
}

// Two-letter-ish initials avatar for a member, with optional avatar image.
export function MemberAvatar({
  name,
  avatar,
  className,
}: {
  name: string;
  avatar?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("h-8 w-8", className)}>
      {avatar && <AvatarImage src={avatar} alt={name} />}
      <AvatarFallback className="text-xs font-medium">
        {name.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

// A section head: brand-tinted icon + heading + optional mono meta string.
export function SectionHead({
  icon,
  title,
  meta,
}: {
  icon: ReactNode;
  title: string;
  meta?: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="text-jigsaw-primary inline-flex">{icon}</span>
      <h2 className="font-heading text-lg font-bold">{title}</h2>
      {meta && (
        <span className="text-muted-foreground font-mono text-xs">{meta}</span>
      )}
    </div>
  );
}

// A single column in the divider-led stats strip.
export function Stat({
  value,
  label,
  divided,
}: {
  value: ReactNode;
  label: string;
  divided?: boolean;
}) {
  return (
    <div className={cn(divided && "border-border sm:border-l sm:pl-5")}>
      <div className="font-heading text-foreground text-3xl font-bold leading-none">
        {value}
      </div>
      <div className="text-muted-foreground mt-1.5 text-sm">{label}</div>
    </div>
  );
}

// Inline star glyph for section heads (matching the lucide stroke style).
export function StarGlyph() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

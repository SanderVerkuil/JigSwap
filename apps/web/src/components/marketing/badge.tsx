import { cn } from "@/lib/utils";
import * as React from "react";

// Marketing badge tones, ported from the design system's Badge TONES map.
// Carries the puzzle difficulty scale as first-class tones.
const TONES = {
  brand: "bg-mk-violet-400 text-white",
  secondary: "bg-mk-muted text-mk-text-strong",
  outline: "bg-transparent text-mk-text-body border-mk-border",
  success: "bg-mk-success-soft text-mk-success-strong",
  warning: "bg-mk-warning-soft text-mk-warning-strong",
  danger: "bg-mk-danger-soft text-mk-danger-strong",
  easy: "bg-mk-diff-easy-bg text-mk-diff-easy-fg",
  medium: "bg-mk-diff-medium-bg text-mk-diff-medium-fg",
  hard: "bg-mk-diff-hard-bg text-mk-diff-hard-fg",
  expert: "bg-mk-diff-expert-bg text-mk-diff-expert-fg",
} as const;

export type MkBadgeTone = keyof typeof TONES;

export function MkBadge({
  tone = "secondary",
  className,
  children,
}: {
  tone?: MkBadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold leading-[1.4] whitespace-nowrap rounded-[6px] border border-transparent",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

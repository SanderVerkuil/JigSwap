import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { chipGradient } from "./palette";

// Gradient cover chip: the design-language stand-in for missing box art — a
// warm two-tone gradient square with a white glyph (or a user-chosen emoji).
export function CoverChip({
  color,
  icon: Icon,
  emoji,
  size = 40,
  className,
}: {
  color: string;
  icon?: LucideIcon;
  emoji?: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg text-white shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]",
        className,
      )}
      style={{ width: size, height: size, background: chipGradient(color) }}
    >
      {emoji ? (
        <span style={{ fontSize: size * 0.42, lineHeight: 1 }}>{emoji}</span>
      ) : (
        Icon && <Icon style={{ width: size * 0.42, height: size * 0.42 }} />
      )}
    </span>
  );
}

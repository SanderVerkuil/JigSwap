"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Grid, List } from "lucide-react";
import { useTranslations } from "use-intl";

export type ViewMode = "grid" | "list";

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}

// The grid/list switch of the catalogue and Browse: a labelled group of two named toggle buttons,
// the current one pressed, so screen readers announce "Grid view, pressed" instead of an unnamed
// button. Touch screens get 44px targets.
export function ViewModeToggle({
  value,
  onChange,
  className,
}: ViewModeToggleProps) {
  const t = useTranslations("common.viewToggle");
  const options = [
    { mode: "grid", label: t("grid"), Icon: Grid },
    { mode: "list", label: t("list"), Icon: List },
  ] as const;
  return (
    <div
      role="group"
      aria-label={t("label")}
      className={cn("flex items-center gap-1", className)}
    >
      {options.map(({ mode, label, Icon }) => (
        <Button
          key={mode}
          type="button"
          size="icon"
          variant={value === mode ? "default" : "outline"}
          aria-label={label}
          aria-pressed={value === mode}
          title={label}
          className="size-9 pointer-coarse:size-11"
          onClick={() => onChange(mode)}
        >
          <Icon className="h-4 w-4" />
        </Button>
      ))}
    </div>
  );
}

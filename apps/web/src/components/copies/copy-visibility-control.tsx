"use client";

import { cn } from "@/lib/utils";
import { Globe, Lock } from "lucide-react";
import { useTranslations } from "use-intl";

export type CopyVisibility = "private" | "visible";

// Owner control for who can see a copy. A copy offered for swap, lend or sale is always visible
// (the backend rejects private + an offer), so while `offered` the Private option is disabled with
// the reason spelled out; the parent switches the value to visible when an offer is turned on.
export function CopyVisibilityControl({
  value,
  onChange,
  offered,
  disabled = false,
}: {
  value: CopyVisibility;
  onChange: (value: CopyVisibility) => void;
  offered: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("copyInstance.editCopy.visibility");
  const options = [
    {
      key: "visible" as const,
      Icon: Globe,
      label: t("visible"),
      hint: t("visibleHint"),
      unavailable: false,
    },
    {
      key: "private" as const,
      Icon: Lock,
      label: t("private"),
      hint: t("privateHint"),
      unavailable: offered,
    },
  ];
  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-label={t("label")}
        className="grid gap-2 sm:grid-cols-2"
      >
        {options.map(({ key, Icon, label, hint, unavailable }) => {
          const selected = value === key;
          const off = disabled || unavailable;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={off}
              onClick={() => onChange(key)}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors",
                selected
                  ? "border-jigsaw-primary bg-jigsaw-primary/5"
                  : "border-border bg-card hover:bg-accent",
                off && "cursor-not-allowed opacity-50 hover:bg-card",
              )}
            >
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  selected ? "text-jigsaw-primary" : "text-muted-foreground",
                )}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{label}</span>
                <span className="text-muted-foreground block text-xs">
                  {hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">
        {offered ? t("privateDisabled") : t("offerNote")}
      </p>
    </div>
  );
}

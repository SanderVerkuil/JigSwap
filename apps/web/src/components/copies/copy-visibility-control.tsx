"use client";

import { cn } from "@/lib/utils";
import { Globe, Lock } from "lucide-react";
import { useTranslations } from "use-intl";

export type CopyVisibility = "private" | "visible";

// Owner control for who can see a copy: the owner's own choice. An offer for swap, lend or sale
// makes a private copy visible only while it lasts, so Private stays selectable while `offered`
// and the note says what that means (private again once every offer is withdrawn).
export function CopyVisibilityControl({
  value,
  onChange,
  offered,
  ownerProfileVisibility,
  disabled = false,
}: {
  value: CopyVisibility;
  onChange: (value: CopyVisibility) => void;
  offered: boolean;
  /** A private profile keeps an offer to friends and shared circles (library/canViewCopy). */
  ownerProfileVisibility?: "public" | "private";
  disabled?: boolean;
}) {
  const t = useTranslations("copyInstance.editCopy.visibility");
  const options = [
    {
      key: "visible" as const,
      Icon: Globe,
      label: t("visible"),
      hint:
        ownerProfileVisibility === "private"
          ? t("visibleHintPrivateProfile")
          : t("visibleHint"),
    },
    {
      key: "private" as const,
      Icon: Lock,
      label: t("private"),
      hint: t("privateHint"),
    },
  ];
  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-label={t("label")}
        className="grid gap-2 sm:grid-cols-2"
      >
        {options.map(({ key, Icon, label, hint }) => {
          const selected = value === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(key)}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors",
                selected
                  ? "border-jigsaw-primary bg-jigsaw-primary/5"
                  : "border-border bg-card hover:bg-accent",
                disabled && "cursor-not-allowed opacity-50 hover:bg-card",
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
        {offered && value === "private"
          ? t("privateWhileOffered")
          : t("offerNote")}
      </p>
    </div>
  );
}

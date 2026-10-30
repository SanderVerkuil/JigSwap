"use client";

import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

// Whether a solve's edit window has closed. `editableUntil` comes from listMyCompletions (the
// domain's completionEditableUntil): null means no deadline (in progress), and undefined (an
// older server that doesn't report it) leaves Edit available; the server still has the final say.
export function isEditClosed(
  editableUntil: number | null | undefined,
  now: number,
): boolean {
  return typeof editableUntil === "number" && now > editableUntil;
}

interface EditSolveButtonProps {
  editableUntil: number | null | undefined;
  onEdit: () => void;
}

// The Edit (pencil) action on a completion row. Once the edit window has closed it stays visible
// but unavailable (aria-disabled, still focusable) and says why: as its tooltip/description, and
// in a toast when tapped, since touch has no hover.
export function EditSolveButton({
  editableUntil,
  onEdit,
}: EditSolveButtonProps) {
  const t = useTranslations("solving.completions");
  const format = useFormatter();
  // Date.now() during render is impure; capture it at mount, and re-check on click below.
  const [renderedAt] = useState(() => Date.now());
  const closed = isEditClosed(editableUntil, renderedAt);
  const reason = () =>
    t("editClosed", {
      when: format.dateTime(new Date(editableUntil ?? 0), {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    });

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      title={closed ? reason() : t("edit")}
      aria-label={t("edit")}
      aria-disabled={closed || undefined}
      onClick={() => {
        if (isEditClosed(editableUntil, Date.now())) toast(reason());
        else onEdit();
      }}
    >
      <Pencil className="h-4 w-4" />
    </Button>
  );
}

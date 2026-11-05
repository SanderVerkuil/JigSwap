"use client";

import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
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

interface EditSolveMenuItemProps {
  editableUntil: number | null | undefined;
  onEdit: () => void;
}

interface EditSolveButtonProps {
  editableUntil: number | null | undefined;
  // Gets the button, for focus to return to when the form closes.
  onEdit: (opener: HTMLElement) => void;
}

// The edit window of one solve, shared by the Edit button and the row menu's Edit item: whether
// it has closed, why (the reason text), and an attempt that opens the form or, once the window has
// closed by now, says why in a toast.
function useEditWindow(editableUntil: number | null | undefined) {
  const t = useTranslations("solving.completions");
  const format = useFormatter();
  // Date.now() during render is impure; capture it at mount, and re-check on attempt below.
  const [renderedAt] = useState(() => Date.now());
  const reason = () =>
    t("editClosed", {
      when: format.dateTime(new Date(editableUntil ?? 0), {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    });
  return {
    closed: isEditClosed(editableUntil, renderedAt),
    reason,
    attempt: (onEdit: () => void) => {
      if (isEditClosed(editableUntil, Date.now())) toast(reason());
      else onEdit();
    },
  };
}

// The Edit (pencil) action on a completion row. Once the edit window has closed it stays visible
// but unavailable (aria-disabled, still focusable) and says why: as its tooltip/description, and
// in a toast when tapped, since touch has no hover.
export function EditSolveButton({
  editableUntil,
  onEdit,
}: EditSolveButtonProps) {
  const t = useTranslations("solving.completions");
  const edit = useEditWindow(editableUntil);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 pointer-coarse:size-11"
      title={edit.closed ? edit.reason() : t("edit")}
      aria-label={t("edit")}
      aria-disabled={edit.closed || undefined}
      onClick={(event) => {
        const opener = event.currentTarget;
        edit.attempt(() => onEdit(opener));
      }}
    >
      <Pencil className="h-4 w-4" />
    </Button>
  );
}

// The same action as an item of the row's actions menu (phones). Once the window has closed it
// stays in the menu, dimmed and aria-disabled but still selectable, and selecting it says why.
export function EditSolveMenuItem({
  editableUntil,
  onEdit,
}: EditSolveMenuItemProps) {
  const t = useTranslations("solving.completions");
  const edit = useEditWindow(editableUntil);

  return (
    <DropdownMenuItem
      aria-disabled={edit.closed || undefined}
      title={edit.closed ? edit.reason() : undefined}
      className="aria-disabled:opacity-50 pointer-coarse:min-h-11"
      onSelect={() => edit.attempt(onEdit)}
    >
      <Pencil aria-hidden />
      {t("edit")}
    </DropdownMenuItem>
  );
}

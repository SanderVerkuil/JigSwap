// A lifecycle action that can't be taken back (decline, cancel, return, the
// completion handover): a labelled trigger that opens an AlertDialog stating
// the one-line consequence. The dialog stays open while the mutation runs (both
// buttons read the pending label) and closes only when `onConfirm` reports
// success, so a refused action leaves the member where they were, next to the
// error toast the caller shows.
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";
import { useState, type ComponentProps } from "react";

export function ConfirmActionButton({
  label,
  pendingLabel,
  icon: Icon,
  title,
  description,
  confirmLabel = label,
  dismissLabel,
  destructive = false,
  variant = "outline",
  pending,
  disabled = false,
  onConfirm,
}: {
  label: string;
  pendingLabel: string;
  icon?: LucideIcon;
  title: string;
  description: string;
  confirmLabel?: string;
  dismissLabel: string;
  destructive?: boolean;
  variant?: ComponentProps<typeof Button>["variant"];
  pending: boolean;
  disabled?: boolean;
  /** Runs the action; resolve true to close the dialog, false to keep it open. */
  onConfirm: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);

  const confirm = async () => {
    if (await onConfirm()) setOpen(false);
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant={variant} size="sm" disabled={disabled || pending}>
          {Icon && <Icon className="h-4 w-4" />}
          {pending ? pendingLabel : label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {dismissLabel}
          </AlertDialogCancel>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

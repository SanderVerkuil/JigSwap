// "Delete circle" for the owner: a destructive, labelled trigger behind an
// AlertDialog that asks for the circle's exact name. The confirm button stays
// disabled until the typed text matches (nothing is trimmed); the server checks
// the same name again. On success the reactive myCircles query drops the circle.
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export function DeleteCircleAction({
  circleId,
  circleName,
  onDeleted,
}: {
  circleId: string;
  circleName: string;
  onDeleted?: () => void;
}) {
  const t = useTranslations("circles");
  const tCommon = useTranslations("common");
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const deleteCircle = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.deleteCircle),
  });
  const matches = typed === circleName;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setTyped("");
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!matches) return;
    try {
      await deleteCircle.mutateAsync({ circleId, confirmName: typed });
      toast.success(t("deleted"));
      handleOpenChange(false);
      onDeleted?.();
    } catch {
      toast.error(t("deleteError"));
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          {t("delete")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="grid gap-4"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("deleteConfirmTitle", { circle: circleName })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={inputId}>
              {t("deleteConfirmLabel", { circle: circleName })}
            </Label>
            <Input
              id={inputId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <Button
              type="submit"
              variant="destructive"
              disabled={!matches || deleteCircle.isPending}
            >
              {t("delete")}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

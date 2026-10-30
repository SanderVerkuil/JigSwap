// "Delete" for something the member wrote themselves — a copy or photo comment, their puzzle
// review, or the written comment of their partner review (SEC-70). A labelled trigger behind an
// AlertDialog confirm that runs the given author-only mutation. Callers render it only where the
// server said the viewer may (the views' canDelete / canClearComment), so an older backend without
// those flags shows nothing. The list queries are reactive: the row drops out by itself.
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import type { FunctionArgs, FunctionReference } from "convex/server";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export type OwnContentKind = "comment" | "review" | "reviewComment";

export function DeleteOwnContentButton<
  Mutation extends FunctionReference<"mutation">,
>({
  kind,
  mutation,
  args,
  onDeleted,
  iconOnly = false,
}: {
  kind: OwnContentKind;
  mutation: Mutation;
  args: FunctionArgs<Mutation>;
  onDeleted?: () => void;
  /** Compact trigger for list rows: the label becomes the accessible name and tooltip. */
  iconOnly?: boolean;
}) {
  const t = useTranslations("ownContent");
  const tCommon = useTranslations("common");
  const run = useConvexMutation(mutation);
  const remove = useMutation({ mutationFn: () => run(args) });
  const label = t(`${kind}.action`);

  const handleConfirm = async () => {
    try {
      await remove.mutateAsync();
      toast.success(t(`${kind}.done`));
      onDeleted?.();
    } catch {
      toast.error(t(`${kind}.error`));
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size={iconOnly ? "icon" : "sm"}
          className={cn(
            "text-muted-foreground hover:text-destructive shrink-0",
            iconOnly ? "size-11 md:size-8" : "h-11 md:h-8",
          )}
          disabled={remove.isPending}
          aria-label={iconOnly ? label : undefined}
          title={iconOnly ? label : undefined}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {!iconOnly && label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${kind}.title`)}</AlertDialogTitle>
          <AlertDialogDescription>{t(`${kind}.body`)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={() => void handleConfirm()}
          >
            {t(`${kind}.confirm`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

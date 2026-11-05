// "Leave circle" for a non-owner member: a destructive, labelled trigger behind
// an AlertDialog confirm. On the circles list the reactive myCircles query
// drops the circle, so there is nothing to navigate to; the circle's own page
// passes `onLeft` to move off a page the member can no longer see.
//
// With `open` the host owns the confirm and there is no trigger here: a ⋯
// menu item opens it (the circles list). The item is gone by the time the
// confirm closes, so `returnFocusRef` names where focus goes back to.
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
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import type { RefObject } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export function LeaveCircleAction({
  circleId,
  circleName,
  onLeft,
  open,
  onOpenChange,
  returnFocusRef,
}: {
  circleId: string;
  circleName: string;
  onLeft?: () => void;
  // Controlled, trigger-less: the host opens the confirm.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("circles");
  const tCommon = useTranslations("common");
  const leaveCircle = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.leaveCircle),
  });

  const handleLeave = async () => {
    try {
      await leaveCircle.mutateAsync({ circleId });
      onLeft?.();
    } catch {
      toast.error(t("leaveError"));
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {open === undefined && (
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive h-11 md:h-8"
            disabled={leaveCircle.isPending}
          >
            <LogOut className="h-4 w-4" />
            {t("leave")}
          </Button>
        </AlertDialogTrigger>
      )}
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          // A trigger that unmounted meanwhile (the row of a circle just
          // left) can't take focus: leave it to Radix.
          const target = returnFocusRef?.current;
          if (!target?.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("leaveConfirmTitle", { circle: circleName })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("leaveConfirmBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={() => void handleLeave()}
          >
            {t("leave")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

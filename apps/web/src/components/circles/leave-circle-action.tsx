// "Leave circle" for a non-owner member: a destructive, labelled trigger behind
// an AlertDialog confirm. On success the reactive myCircles query drops the
// circle from the list, so there is nothing to navigate to.
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
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export function LeaveCircleAction({
  circleId,
  circleName,
}: {
  circleId: string;
  circleName: string;
}) {
  const t = useTranslations("circles");
  const tCommon = useTranslations("common");
  const leaveCircle = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.leaveCircle),
  });

  const handleLeave = async () => {
    try {
      await leaveCircle.mutateAsync({ circleId });
    } catch {
      toast.error(t("leaveError"));
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={leaveCircle.isPending}
        >
          <LogOut className="h-4 w-4" />
          {t("leave")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
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

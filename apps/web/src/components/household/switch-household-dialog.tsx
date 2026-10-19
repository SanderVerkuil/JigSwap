import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import type { FunctionReturnType } from "convex/server";
import { useTranslations } from "use-intl";

type CurrentHousehold = NonNullable<
  FunctionReturnType<typeof gateway.household.mine>
>;

// What leaving the CURRENT household means, under the same rules the server applies on
// leaveCurrentHousehold: the last member's household is deleted (its open invitations go too);
// an admin leaving housemates hands over to the longest-standing member; your puzzles leave with
// you either way.
export function leaveConsequence(
  current: CurrentHousehold,
):
  | { kind: "deleted" }
  | { kind: "handover"; nextAdmin: CurrentHousehold["members"][number] }
  | { kind: "leave" } {
  const others = current.members.filter((member) => !member.isYou);
  if (others.length === 0) return { kind: "deleted" };
  if (
    current.viewerRole === "admin" &&
    !others.some((m) => m.role === "admin")
  ) {
    const nextAdmin = others.reduce((a, b) =>
      b.joinedAt < a.joinedAt ? b : a,
    );
    return { kind: "handover", nextAdmin };
  }
  return { kind: "leave" };
}

// Confirm "leave your household and join <inviter>'s": names both households and the
// consequences before the one irreversible step (the server leaves and joins atomically). The
// "request" variant is the same consent given up front when asking to join: if the admin lets
// the member in, the switch happens then, without asking again.
export function SwitchHouseholdDialog({
  open,
  onOpenChange,
  current,
  inviterName,
  busy,
  onConfirm,
  variant = "join",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: CurrentHousehold;
  inviterName: string;
  busy: boolean;
  onConfirm: () => void;
  variant?: "join" | "request";
}) {
  const t = useTranslations("household.switch");
  const tCommon = useTranslations("common");
  const displayName = useMemberDisplayName();
  const currentName = current.name ?? t("yourHousehold");
  const consequence = leaveConsequence(current);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {variant === "request"
              ? t("requestTitle", { name: inviterName })
              : t("title", { current: currentName, name: inviterName })}
          </AlertDialogTitle>
          {variant === "request" && (
            <p className="text-muted-foreground text-sm">
              {t("requestLead", { name: inviterName })}
            </p>
          )}
          <AlertDialogDescription asChild>
            <ul className="list-disc space-y-1 pl-5 text-left">
              <li>
                {consequence.kind === "deleted"
                  ? t("deleted", { current: currentName })
                  : consequence.kind === "handover"
                    ? t("handover", {
                        current: currentName,
                        name: displayName(consequence.nextAdmin),
                      })
                    : t("leave", { current: currentName })}
              </li>
              <li>{t("puzzles")}</li>
              <li>
                {variant === "request"
                  ? t("requestJoin", { name: inviterName })
                  : t("join", { name: inviterName })}
              </li>
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            disabled={busy}
            onClick={onConfirm}
          >
            {variant === "request" ? t("requestConfirm") : t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

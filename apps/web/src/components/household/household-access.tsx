import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { gateway, Id } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { House } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import {
  type HouseholdPermissionChoice,
  ownerChoiceOf,
} from "./bulk-permission";

type Permission = "manage" | "view";

// The copy page's household line. The OWNER (in a household) picks whether the household may
// manage the copy, only view it, or follow the household default (clearing the explicit value);
// a household member sees which of the two applies to them.
// Rendered only when the copy view carries household facts.
export function HouseholdAccess({
  copyId,
  household,
}: {
  copyId: string;
  household: {
    permission: Permission;
    viewerAccess: "owner" | "manage" | "view";
    inheritsDefault: boolean;
    householdDefault: Permission;
  };
}) {
  const t = useTranslations("household.copyAccess");
  const setPermission = useMutation({
    mutationFn: useConvexMutation(gateway.library.setHouseholdPermission),
    onError: () => toast.error(t("saveFailed")),
  });

  if (household.viewerAccess !== "owner") {
    return (
      <p className="text-muted-foreground mt-4 flex items-center gap-1.5 text-sm">
        <House className="h-3.5 w-3.5" />
        {household.viewerAccess === "manage"
          ? t("memberManage")
          : t("memberView")}
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <span
        id="household-access-label"
        className="text-muted-foreground flex items-center gap-1.5 text-sm"
      >
        <House className="h-3.5 w-3.5" />
        {t("label")}
      </span>
      <Select
        value={ownerChoiceOf(household)}
        disabled={setPermission.isPending}
        onValueChange={(permission: HouseholdPermissionChoice) =>
          setPermission.mutate({
            copyId: copyId as Id<"ownedPuzzles">,
            permission,
          })
        }
      >
        <SelectTrigger
          className="w-auto min-w-44"
          aria-labelledby="household-access-label"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">
            {t("useDefault", { permission: household.householdDefault })}
          </SelectItem>
          <SelectItem value="manage">{t("manage")}</SelectItem>
          <SelectItem value="view">{t("view")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

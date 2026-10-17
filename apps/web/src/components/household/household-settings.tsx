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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import type { HouseholdPermission } from "./bulk-permission";

// "Household settings": the household-wide default access for member copies without their own
// choice. Every member sees it and how many copies follow it (counted server-side across all
// members); only the admin can change it, after confirming how many copies it affects.
export function HouseholdSettings({
  isAdmin,
  defaultCopyPermission,
  copiesUsingDefault,
  onError,
}: {
  isAdmin: boolean;
  defaultCopyPermission: HouseholdPermission;
  copiesUsingDefault: number;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations("household.settings");
  const tAccess = useTranslations("household.copyAccess");
  const tCommon = useTranslations("common");
  const [pending, setPending] = useState<HouseholdPermission | null>(null);

  const setDefault = useMutation({
    mutationFn: useConvexMutation(gateway.household.setDefaultCopyPermission),
    onSuccess: () => toast.success(t("saved")),
    onError,
  });

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-heading flex items-center gap-2 text-lg font-bold">
        <Settings className="h-4 w-4" />
        {t("title")}
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <span id="household-default-label" className="text-sm font-medium">
          {t("defaultLabel")}
        </span>
        {isAdmin ? (
          <Select
            value={defaultCopyPermission}
            disabled={setDefault.isPending}
            onValueChange={(value: HouseholdPermission) => {
              if (value !== defaultCopyPermission) setPending(value);
            }}
          >
            <SelectTrigger
              className="w-44"
              aria-labelledby="household-default-label"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manage">{tAccess("manage")}</SelectItem>
              <SelectItem value="view">{tAccess("view")}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span className="text-sm">{tAccess(defaultCopyPermission)}</span>
        )}
      </div>
      <p className="text-muted-foreground text-sm">{t("defaultHelp")}</p>
      <p className="text-sm">{t("affected", { count: copiesUsingDefault })}</p>
      {!isAdmin && (
        <p className="text-muted-foreground text-xs">{t("adminOnly")}</p>
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("confirmTitle", { permission: pending ?? "manage" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmBody", { count: copiesUsingDefault })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) setDefault.mutate({ permission: pending });
                setPending(null);
              }}
            >
              {t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

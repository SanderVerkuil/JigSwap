"use client";

// Shared grant/revoke-admin affordance used by BOTH the /admin/users table rows
// and the /admin/users/$userId detail page (the two call sites that justify the
// extraction). Renders the trigger button plus its controlled AlertDialog
// confirm, calls the setUserRole ACTION (Clerk write + mirror fast-path + audit
// stamp) via useConvexAction, and renders NOTHING for the caller's own row/page
// — the server's CannotChangeOwnRole gate is the real enforcement; the UI just
// doesn't offer the foot-gun.

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
import { Button, buttonVariants } from "@/components/ui/button";
import { gateway, type Id } from "@/gateway";
import { convexQuery, useConvexAction } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export function UserRoleAction({
  userId,
  name,
  role,
}: {
  userId: string;
  name: string;
  /** The DISPLAY-ONLY mirrored Clerk role (users.role) — never used for authz. */
  role?: string;
}) {
  const t = useTranslations("admin.users");
  const tCommon = useTranslations("common");
  const [confirming, setConfirming] = useState(false);

  // The signed-in admin's own row/page shows no affordance (CurrentMemberView
  // shares the users table _id). TanStack Query dedupes this across instances.
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));

  const setRole = useMutation({
    mutationFn: useConvexAction(gateway.admin.setUserRole),
  });

  if (!me || me._id === userId) return null;

  const granting = role !== "admin";

  const changeRole = async () => {
    try {
      await setRole.mutateAsync({
        userId: userId as Id<"users">,
        role: granting ? "admin" : null,
      });
      toast.success(
        granting ? t("grantSuccess", { name }) : t("revokeSuccess", { name }),
      );
    } catch {
      // Covers Clerk failures and the server self-guard (unreachable via this
      // UI, which hides the own-row affordance).
      toast.error(granting ? t("grantError") : t("revokeError"));
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setConfirming(true)}
        disabled={setRole.isPending}
        className={
          granting ? undefined : "text-destructive hover:text-destructive"
        }
      >
        {granting ? t("makeAdmin") : t("removeAdmin")}
      </Button>
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open) setConfirming(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {granting
                ? t("grantConfirmTitle", { name })
                : t("revokeConfirmTitle", { name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {granting ? t("grantConfirmBody") : t("revokeConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={
                granting
                  ? undefined
                  : buttonVariants({ variant: "destructive" })
              }
              onClick={() => {
                setConfirming(false);
                void changeRole();
              }}
            >
              {granting ? t("makeAdmin") : t("removeAdmin")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

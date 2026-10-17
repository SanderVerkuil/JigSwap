import { householdErrorKey } from "@/components/household/household-error";
import { HouseholdInviteLink } from "@/components/household/household-invite-link";
import { HouseholdMemberInvite } from "@/components/household/household-member-invite";
import { HouseholdSettings } from "@/components/household/household-settings";
import { MyHouseholdCopies } from "@/components/household/my-household-copies";
import { PersonRow, type Person } from "@/components/household/person-row";
import { EmptyState } from "@/components/library/empty-state";
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
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway, Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { pageTitle } from "@/lib/page-title";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { Check, House, LogOut, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/household")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "household") }],
  }),
  pendingComponent: () => <HouseholdPending />,
  component: HouseholdPage,
});

function HouseholdPending() {
  const t = useTranslations("household");
  return <PageLoading message={t("loading")} />;
}

type HouseholdData = NonNullable<
  FunctionReturnType<typeof gateway.household.mine>
>;

function HouseholdPage() {
  const t = useTranslations("household");

  const { data: household, isPending: householdPending } = useQuery(
    convexQuery(gateway.household.mine, {}),
  );
  const { data: invites } = useQuery(
    convexQuery(gateway.household.myInvites, {}),
  );

  const fail = (error: unknown) => toast.error(t(householdErrorKey(error)));

  const create = useMutation({
    mutationFn: useConvexMutation(gateway.household.create),
    onError: fail,
  });
  const accept = useMutation({
    mutationFn: useConvexMutation(gateway.household.acceptInvite),
    onSuccess: () => toast.success(t("joined")),
    onError: fail,
  });
  const decline = useMutation({
    mutationFn: useConvexMutation(gateway.household.declineInvite),
    onError: fail,
  });

  if (householdPending || household === undefined) {
    return <PageLoading message={t("loading")} />;
  }

  if (household === null) {
    return (
      <div className="flex flex-col gap-6">
        {invites && invites.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-heading text-lg font-bold">
              {t("invites.title")}
            </h2>
            <div className="divide-y rounded-lg border px-4">
              {invites.map((invite) => (
                <PersonRow key={invite.inviteId} person={invite.inviter}>
                  <span className="text-muted-foreground hidden text-sm sm:inline">
                    {t("invites.from")}
                  </span>
                  <Button
                    size="sm"
                    variant="brand"
                    disabled={accept.isPending}
                    onClick={() => accept.mutate({ inviteId: invite.inviteId })}
                  >
                    <Check className="h-4 w-4" />
                    {t("invites.accept")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decline.isPending}
                    onClick={() =>
                      decline.mutate({ inviteId: invite.inviteId })
                    }
                  >
                    <X className="h-4 w-4" />
                    {t("invites.decline")}
                  </Button>
                </PersonRow>
              ))}
            </div>
          </section>
        )}

        <EmptyState
          title={t("empty.title")}
          sub={t("empty.sub")}
          action={
            <Button
              variant="brand"
              data-tour="household-main"
              data-tour-action=""
              disabled={create.isPending}
              onClick={() => create.mutate({})}
            >
              <House className="h-4 w-4" />
              {t("empty.create")}
            </Button>
          }
        />
      </div>
    );
  }

  return <HouseholdDetails household={household} onError={fail} />;
}

function HouseholdDetails({
  household,
  onError,
}: {
  household: HouseholdData;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations("household");
  const tCommon = useTranslations("common");
  const displayName = useMemberDisplayName();
  const isAdmin = household.viewerRole === "admin";
  const viewerId =
    household.members.find((member) => member.isYou)?.memberId ?? "";
  const [removeTarget, setRemoveTarget] = useState<Person | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const remove = useMutation({
    mutationFn: useConvexMutation(gateway.household.removeMember),
    onError,
  });
  const leave = useMutation({
    mutationFn: useConvexMutation(gateway.household.leave),
    onError,
  });

  // Never offer someone who is already a member or already has a pending invite.
  const excluded = new Set([
    ...household.members.map((m) => m.memberId),
    ...household.pendingInvites.map((i) => i.invitee.memberId),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <p className="text-muted-foreground max-w-2xl text-sm">
        {t("explainer")}
      </p>

      <section className="space-y-2" data-tour="household-main">
        <h2 className="font-heading text-lg font-bold">{t("members.title")}</h2>
        <div className="divide-y rounded-lg border px-4">
          {household.members.map((member) => (
            <PersonRow
              key={member.memberId}
              person={member}
              badge={
                <>
                  {member.isYou && (
                    <span className="text-muted-foreground text-xs">
                      {t("members.you")}
                    </span>
                  )}
                  {member.role === "admin" && (
                    <Badge variant="secondary" className="text-xs">
                      {t("members.admin")}
                    </Badge>
                  )}
                </>
              }
            >
              {isAdmin && !member.isYou && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRemoveTarget(member)}
                >
                  {t("members.remove")}
                </Button>
              )}
            </PersonRow>
          ))}
        </div>
      </section>

      {isAdmin && (
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-bold">
            {t("invite.title")}
          </h2>
          <HouseholdMemberInvite excludedIds={excluded} onError={onError} />

          <HouseholdInviteLink memberId={viewerId} />

          {household.pendingInvites.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">{t("invite.pending")}</h3>
              <div className="divide-y rounded-lg border px-4">
                {household.pendingInvites.map((pending) => (
                  <PersonRow
                    key={pending.inviteId}
                    person={pending.invitee}
                    badge={
                      <Badge variant="outline" className="text-xs">
                        {t("invite.pendingBadge")}
                      </Badge>
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <HouseholdSettings
        isAdmin={isAdmin}
        defaultCopyPermission={household.defaultCopyPermission}
        copiesUsingDefault={household.copiesUsingDefault}
        onError={onError}
      />

      <MyHouseholdCopies
        householdDefault={household.defaultCopyPermission}
        onError={onError}
      />

      <section>
        <Button variant="outline" onClick={() => setConfirmLeave(true)}>
          <LogOut className="h-4 w-4" />
          {t("leave.action")}
        </Button>
      </section>

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("members.removeTitle", { name: displayName(removeTarget) })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("members.removeBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (removeTarget) {
                  remove.mutate({
                    memberId: removeTarget.memberId as Id<"users">,
                  });
                }
                setRemoveTarget(null);
              }}
            >
              {t("members.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("leave.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {household.members.length === 1
                ? t("leave.bodyLast")
                : t("leave.body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                leave.mutate({});
                setConfirmLeave(false);
              }}
            >
              {t("leave.action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { CircleAvatarStack } from "@/components/circles/circle-avatar-stack";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { HouseholdInviteDialog } from "@/components/household/household-invite-dialog";
import { HouseholdPendingList } from "@/components/household/household-pending-list";
import { HouseholdPuzzles } from "@/components/household/household-puzzles";
import { HouseholdSettings } from "@/components/household/household-settings";
import { MyHouseholdCopies } from "@/components/household/my-household-copies";
import { MyJoinRequestCard } from "@/components/household/my-join-request-card";
import { PersonRow, type Person } from "@/components/household/person-row";
import { SwitchHouseholdDialog } from "@/components/household/switch-household-dialog";
import { EmptyState } from "@/components/library/empty-state";
import { MemberInitial } from "@/components/members/member-initial";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  StickyTabsBar,
  TAB_TRIGGER_CLASS,
  TabCount,
  UNDERLINE_TABS_LIST_CLASS,
} from "@/components/ui/underline-tabs";
import { gateway, Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { cn } from "@/lib/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import {
  Check,
  House,
  LogOut,
  MoreHorizontal,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// The household page's views (the route in routes/_dashboard/household.tsx only loads the data
// and owns the ?tab= search param). Puzzles (default: every puzzle in the household), Members,
// Sharing (the viewer's own puzzles' household access) and Settings tabs; the admin's single
// Invite action lives in the shell page head and opens HouseholdInviteDialog.

export type HouseholdTab = "puzzles" | "members" | "sharing" | "settings";

// Four tabs fit a phone's width with a tighter trigger padding below sm.
const HOUSEHOLD_TAB_CLASS = cn(TAB_TRIGGER_CLASS, "px-2 sm:px-4");

export type HouseholdData = NonNullable<
  FunctionReturnType<typeof gateway.household.mine>
>;
export type IncomingInvites = FunctionReturnType<
  typeof gateway.household.myInvites
>;

// Not in a household: incoming invites come first (accepting is the likelier intent), with
// "create your own" as the quiet alternative; with no invites, the create empty state.
export function NoHousehold({
  invites,
  onError,
}: {
  invites: IncomingInvites;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations("household");
  const tInvite = useTranslations("invite");
  const displayName = useMemberDisplayName();

  const create = useMutation({
    mutationFn: useConvexMutation(gateway.household.create),
    onError,
  });
  const accept = useMutation({
    mutationFn: useConvexMutation(gateway.household.acceptInvite),
    onSuccess: () => toast.success(t("joined")),
    onError,
  });
  const decline = useMutation({
    mutationFn: useConvexMutation(gateway.household.declineInvite),
    onError,
  });

  if (invites.length === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <MyJoinRequestCard onError={onError} />
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

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <MyJoinRequestCard onError={onError} />
      <section className="space-y-3" data-tour="household-main">
        <h2 className="font-heading text-lg font-bold">{t("invites.title")}</h2>
        {invites.map((invite) => (
          <div
            key={invite.inviteId}
            className="border-jigsaw-primary/20 bg-jigsaw-primary/5 flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Avatar className="h-9 w-9">
                <AvatarImage src={invite.inviter.avatar} />
                <AvatarFallback>
                  <MemberInitial source={invite.inviter} />
                </AvatarFallback>
              </Avatar>
              <p className="min-w-0 text-sm font-medium">
                {tInvite("householdLinkTitle", {
                  name: displayName(invite.inviter),
                })}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                size="sm"
                variant="brand"
                className="pointer-coarse:min-h-11"
                disabled={accept.isPending}
                onClick={() => accept.mutate({ inviteId: invite.inviteId })}
              >
                <Check className="h-4 w-4" />
                {t("invites.accept")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="pointer-coarse:min-h-11"
                disabled={decline.isPending}
                onClick={() => decline.mutate({ inviteId: invite.inviteId })}
              >
                <X className="h-4 w-4" />
                {t("invites.decline")}
              </Button>
            </div>
          </div>
        ))}
      </section>

      <div className="flex flex-col items-start gap-2 border-t pt-6">
        <p className="text-muted-foreground text-sm">{t("empty.orCreate")}</p>
        <Button
          variant="outline"
          className="pointer-coarse:min-h-11"
          disabled={create.isPending}
          onClick={() => create.mutate({})}
        >
          <House className="h-4 w-4" />
          {t("empty.create")}
        </Button>
      </div>
    </div>
  );
}

export function HouseholdDetails({
  household,
  invites,
  activeTab,
  onTabChange,
  onError,
}: {
  household: HouseholdData;
  // Invites the viewer received from OTHER households: accepting means leaving this one.
  invites: IncomingInvites;
  activeTab: HouseholdTab;
  onTabChange: (tab: HouseholdTab) => void;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations("household");
  const tAccess = useTranslations("household.copyAccess");
  const tCommon = useTranslations("common");
  const displayName = useMemberDisplayName();
  const isAdmin = household.viewerRole === "admin";
  const viewerId =
    household.members.find((member) => member.isYou)?.memberId ?? "";
  const [inviteOpen, setInviteOpen] = useState(false);
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

  // The one primary action, in the shell page head: the admin's Invite (icon-only on phones).
  usePageHeader(
    () => ({
      // The household's own name, when the members gave it one, replaces the static title.
      title: household.name,
      actions: isAdmin ? (
        <Button
          variant="brand"
          data-tour="household-invite"
          aria-label={t("invite.action")}
          className="size-11 p-0 sm:h-9 sm:w-auto sm:px-3"
          onClick={() => setInviteOpen(true)}
        >
          <UserPlus aria-hidden className="size-4" />
          <span className="hidden sm:inline">{t("invite.action")}</span>
        </Button>
      ) : undefined,
    }),
    [household.name, isAdmin, t],
  );

  // Never offer someone who is already a member or already has a pending invite.
  const excluded = new Set([
    ...household.members.map((m) => m.memberId),
    ...household.pendingInvites.map((i) => i.invitee.memberId),
  ]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <MyJoinRequestCard onError={onError} />
      {invites.map((invite) => (
        <SwitchInviteCard
          key={invite.inviteId}
          invite={invite}
          current={household}
          onError={onError}
        />
      ))}

      <div
        data-tour="household-main"
        className="flex flex-wrap items-center gap-x-3 gap-y-2"
      >
        <CircleAvatarStack
          circleName={household.name ?? t("header.stackName")}
          members={household.members.map((member) => ({
            key: member.memberId,
            name: displayName(member),
            avatar: member.avatar,
            fallback: <MemberInitial source={member} />,
          }))}
        />
        <span className="text-muted-foreground text-sm">
          {t("header.memberCount", { count: household.members.length })}
        </span>
        <Badge variant="secondary">
          {isAdmin ? t("members.admin") : t("members.member")}
        </Badge>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => onTabChange(value as HouseholdTab)}
      >
        <StickyTabsBar>
          <TabsList className={UNDERLINE_TABS_LIST_CLASS}>
            <TabsTrigger value="puzzles" className={HOUSEHOLD_TAB_CLASS}>
              {t("tabs.puzzles")}
            </TabsTrigger>
            <TabsTrigger
              value="members"
              className={HOUSEHOLD_TAB_CLASS}
              // For members, the tour's invite step explains who invites; the note itself sits in
              // this (unmounted until opened) tab.
              data-tour={isAdmin ? undefined : "household-invite"}
            >
              {t("tabs.members")}
              <TabCount count={household.members.length} />
              {/* Requests to join wait on this (not default) tab: a dot tells the admin. */}
              {isAdmin && household.joinRequests.length > 0 && (
                <span className="bg-jigsaw-primary size-2 rounded-full">
                  <span className="sr-only">
                    {t("pending.requestsDot", {
                      count: household.joinRequests.length,
                    })}
                  </span>
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="sharing"
              className={HOUSEHOLD_TAB_CLASS}
              data-tour="household-my-copies"
            >
              {t("tabs.sharing")}
            </TabsTrigger>
            <TabsTrigger value="settings" className={HOUSEHOLD_TAB_CLASS}>
              {t("tabs.settings")}
            </TabsTrigger>
          </TabsList>
        </StickyTabsBar>

        <TabsContent value="puzzles" className="mt-4">
          <HouseholdPuzzles
            household={household}
            onInvite={isAdmin ? () => setInviteOpen(true) : undefined}
          />
        </TabsContent>

        <TabsContent value="members" className="mt-4 flex flex-col gap-6">
          <section>
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="-mr-2 size-11"
                          aria-label={t("members.menuLabel", {
                            name: displayName(member),
                          })}
                        >
                          <MoreHorizontal aria-hidden className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setRemoveTarget(member)}
                        >
                          <UserMinus aria-hidden />
                          {t("members.removeAction")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </PersonRow>
              ))}
            </div>
          </section>

          {isAdmin && (
            <HouseholdPendingList
              requests={household.joinRequests}
              inApp={household.pendingInvites}
              onError={onError}
            />
          )}

          {!isAdmin && (
            <p className="text-muted-foreground text-sm">
              {t("members.adminOnlyInvite")}
            </p>
          )}
        </TabsContent>

        <TabsContent value="sharing" className="mt-4 flex flex-col gap-6">
          <p className="text-muted-foreground text-sm">
            {t("puzzles.defaultLabel")}{" "}
            <span className="text-foreground font-medium">
              {tAccess(household.defaultCopyPermission)}
            </span>
          </p>
          <MyHouseholdCopies
            householdDefault={household.defaultCopyPermission}
            onError={onError}
          />
        </TabsContent>

        <TabsContent value="settings" className="mt-4 flex flex-col gap-6">
          <p className="text-muted-foreground max-w-2xl text-sm">
            {t("explainer")}
          </p>

          <HouseholdSettings
            isAdmin={isAdmin}
            name={household.name}
            defaultCopyPermission={household.defaultCopyPermission}
            copiesUsingDefault={household.copiesUsingDefault}
            onError={onError}
          />

          <section className="border-destructive/40 bg-destructive/5 flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h2 className="font-heading text-lg font-bold">
                {t("danger.title")}
              </h2>
              <p className="text-muted-foreground text-sm">
                {household.members.length === 1
                  ? t("leave.bodyLast")
                  : t("leave.body")}
              </p>
            </div>
            <Button
              variant="outline"
              className="text-destructive pointer-coarse:min-h-11 shrink-0 sm:self-center"
              onClick={() => setConfirmLeave(true)}
            >
              <LogOut aria-hidden className="h-4 w-4" />
              {t("leave.action")}
            </Button>
          </section>
        </TabsContent>
      </Tabs>

      {isAdmin && (
        <HouseholdInviteDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          memberId={viewerId}
          householdName={household.name}
          excludedIds={excluded}
          onError={onError}
        />
      )}

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

// An invite to another household, seen by someone who is already in one: "<name> invited you to
// their household", with Leave and join (confirmed, see SwitchHouseholdDialog) or Decline.
function SwitchInviteCard({
  invite,
  current,
  onError,
}: {
  invite: IncomingInvites[number];
  current: HouseholdData;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations("household");
  const tInvite = useTranslations("invite");
  const displayName = useMemberDisplayName();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inviterName = displayName(invite.inviter);

  const accept = useMutation({
    mutationFn: useConvexMutation(gateway.household.acceptInvite),
    onSuccess: () => toast.success(t("joined")),
    onError,
  });
  const decline = useMutation({
    mutationFn: useConvexMutation(gateway.household.declineInvite),
    onError,
  });
  const busy = accept.isPending || decline.isPending;

  return (
    <section className="border-jigsaw-primary/20 bg-jigsaw-primary/5 flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar className="h-9 w-9">
          <AvatarImage src={invite.inviter.avatar} />
          <AvatarFallback>
            <MemberInitial source={invite.inviter} />
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-medium">
            {tInvite("householdLinkTitle", { name: inviterName })}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t("switch.cardBody", {
              current: current.name ?? t("switch.yourHousehold"),
            })}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          size="sm"
          variant="brand"
          className="pointer-coarse:min-h-11"
          disabled={busy}
          onClick={() => setConfirmOpen(true)}
        >
          <LogOut aria-hidden className="h-4 w-4" />
          {t("switch.confirm")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="pointer-coarse:min-h-11"
          disabled={busy}
          onClick={() => decline.mutate({ inviteId: invite.inviteId })}
        >
          <X className="h-4 w-4" />
          {t("invites.decline")}
        </Button>
      </div>
      <SwitchHouseholdDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        current={current}
        inviterName={inviterName}
        busy={busy}
        onConfirm={() => {
          accept.mutate({
            inviteId: invite.inviteId,
            leaveCurrentHousehold: true,
          });
          setConfirmOpen(false);
        }}
      />
    </section>
  );
}

"use client";

import { householdErrorKey } from "@/components/household/household-error";
import { HouseholdInviteLink } from "@/components/household/household-invite-link";
import { HouseholdMemberInvite } from "@/components/household/household-member-invite";
import { PersonRow } from "@/components/household/person-row";
import { MemberInitial } from "@/components/members/member-initial";
import { EmailInvite } from "@/components/social/email-invite";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { House } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { PRIMARY_LOOK } from "./parts";
import { PushPrompt } from "./push-prompt";

type Invite = FunctionReturnType<typeof gateway.household.myInvites>[number];
type Household = NonNullable<FunctionReturnType<typeof gateway.household.mine>>;

// Step 4, Household (optional; spec §2.4). A pending invite comes first (D6): accept or decline
// it here. In a household, the members and (for admins) the invite panel. Otherwise, the
// explainer and "Create a household"; "I puzzle alone" is the same as Skip.
export function HouseholdStep({ onAlone }: { onAlone: () => void }) {
  const t = useTranslations("household");
  const { data: household } = useQuery(convexQuery(gateway.household.mine, {}));
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

  if (household === undefined || invites === undefined) {
    return <Skeleton className="h-24 w-full" />;
  }
  if (household) {
    return <InHousehold household={household} onError={fail} />;
  }
  return (
    <HouseholdChoiceView
      invites={invites}
      busy={create.isPending || accept.isPending || decline.isPending}
      onAccept={(inviteId) => accept.mutate({ inviteId })}
      onDecline={(inviteId) => decline.mutate({ inviteId })}
      onCreate={() => create.mutate({})}
      onAlone={onAlone}
    />
  );
}

/** Not in a household yet: pending invites first, then the create / alone choice. */
export function HouseholdChoiceView({
  invites,
  busy,
  onAccept,
  onDecline,
  onCreate,
  onAlone,
}: {
  invites: readonly Invite[];
  busy: boolean;
  onAccept: (inviteId: Invite["inviteId"]) => void;
  onDecline: (inviteId: Invite["inviteId"]) => void;
  onCreate: () => void;
  onAlone: () => void;
}) {
  const t = useTranslations("quickStart.household");
  const th = useTranslations("household");
  const displayName = useMemberDisplayName();

  if (invites.length > 0) {
    return (
      <div className="flex flex-col gap-3">
        {invites.map((invite) => (
          <div
            key={invite.inviteId}
            className="border-jigsaw-primary/20 bg-jigsaw-primary/5 flex flex-col gap-3 rounded-xl border px-4 py-3"
          >
            <div className="flex items-center gap-3.5">
              <Avatar className="size-10" aria-hidden>
                {invite.inviter.avatar && (
                  <AvatarImage src={invite.inviter.avatar} alt="" />
                )}
                <AvatarFallback>
                  <MemberInitial source={invite.inviter} />
                </AvatarFallback>
              </Avatar>
              <p className="min-w-0 flex-1 text-sm font-medium">
                {t("pendingTitle", { name: displayName(invite.inviter) })}
              </p>
            </div>
            <p className="text-muted-foreground text-sm">{th("explainer")}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                className={PRIMARY_LOOK}
                disabled={busy}
                onClick={() => onAccept(invite.inviteId)}
              >
                {th("invites.accept")}
              </Button>
              <Button
                variant="ghost"
                className="pointer-coarse:min-h-11"
                disabled={busy}
                onClick={() => onDecline(invite.inviteId)}
              >
                {th("invites.decline")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">{t("lead")}</p>
      <p className="text-muted-foreground text-sm">{th("explainer")}</p>
      <div className="flex flex-wrap gap-2">
        <Button className={PRIMARY_LOOK} disabled={busy} onClick={onCreate}>
          <House aria-hidden className="size-4" />
          {t("create")}
        </Button>
        <Button
          variant="outline"
          className="pointer-coarse:min-h-11"
          onClick={onAlone}
        >
          {t("alone")}
        </Button>
      </div>
    </div>
  );
}

function InHousehold({
  household,
  onError,
}: {
  household: Household;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations("quickStart.household");
  const th = useTranslations("household");
  const [shared, setShared] = useState(false);
  const isAdmin = household.viewerRole === "admin";
  const viewerId = household.members.find((m) => m.isYou)?.memberId ?? "";
  const excluded = new Set([
    ...household.members.map((m) => m.memberId),
    ...household.pendingInvites.map((i) => i.invitee.memberId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="divide-y rounded-lg border px-4">
        {household.members.map((member) => (
          <PersonRow
            key={member.memberId}
            person={member}
            badge={
              member.isYou ? (
                <span className="text-muted-foreground text-xs">
                  {th("members.you")}
                </span>
              ) : undefined
            }
          />
        ))}
      </div>
      {isAdmin && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">{t("inviteMember")}</h3>
          <HouseholdMemberInvite excludedIds={excluded} onError={onError} />
          <HouseholdInviteLink
            memberId={viewerId}
            onShared={() => setShared(true)}
          />
          <EmailInvite kind="household" />
          <PushPrompt triggered={shared} />
        </section>
      )}
    </div>
  );
}

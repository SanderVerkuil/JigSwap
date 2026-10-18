// The circle's open invites, for its Admins (listCircleInvites): who was invited, when, and when
// the invite expires, each with a confirmed Revoke. Invitees are projected server-side, so an
// anonymised one renders as the generic member label.
import { circleInviteErrorKey } from "@/components/circles/circle-invite-error";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

export type PendingCircleInvite = FunctionReturnType<
  typeof gateway.sharing.circleInvites
>[number];

export function CirclePendingInvites({ circleId }: { circleId: string }) {
  const t = useTranslations("circles");
  const { data: invites } = useQuery(
    convexQuery(gateway.sharing.circleInvites, { circleId }),
  );
  const revoke = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.revokeInvite),
    onSuccess: () => toast.success(t("invite.revoked")),
    onError: (error) => toast.error(t(circleInviteErrorKey(error))),
  });

  if (!invites || invites.length === 0) return null;
  return (
    <PendingInviteList
      invites={invites}
      busy={revoke.isPending}
      onRevoke={(invite) => revoke.mutate({ inviteId: invite.inviteId })}
    />
  );
}

export function PendingInviteList({
  invites,
  busy = false,
  onRevoke,
}: {
  invites: PendingCircleInvite[];
  busy?: boolean;
  onRevoke: (invite: PendingCircleInvite) => void;
}) {
  const t = useTranslations("circles");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const relativeTime = useRelativeTime();
  const displayName = useMemberDisplayName();

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">{t("invite.pendingTitle")}</h4>
      <ul className="divide-y rounded-lg border px-4">
        {invites.map((invite) => {
          const member = invite.invitee.anonymous
            ? null
            : invite.invitee.member;
          const name = displayName(member);
          return (
            <li
              key={invite.inviteId}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="h-9 w-9">
                  {member?.avatar && <AvatarImage src={member.avatar} alt="" />}
                  <AvatarFallback>
                    <MemberInitial source={member} />
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{name}</p>
                  <p className="text-muted-foreground text-xs">
                    {t("invite.pendingMeta", {
                      when: relativeTime(invite.createdAt),
                      date: format.dateTime(invite.expiresAt, {
                        dateStyle: "medium",
                      }),
                    })}
                  </p>
                </div>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive shrink-0"
                    disabled={busy}
                  >
                    <Undo2 className="h-4 w-4" />
                    {t("invite.revoke")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("invite.revokeConfirmTitle", { name })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("invite.revokeConfirmBody")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      className={buttonVariants({ variant: "destructive" })}
                      onClick={() => onRevoke(invite)}
                    >
                      {t("invite.revoke")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

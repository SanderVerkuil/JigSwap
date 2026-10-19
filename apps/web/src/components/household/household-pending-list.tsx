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
import {
  convexQuery,
  useConvexAction,
  useConvexMutation,
} from "@convex-dev/react-query";
import type {
  EmailInviteView,
  HouseholdSentInviteView,
} from "@jigswap/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Mail, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

// One pending row on the Members tab: an in-app invite (by name) or an email invitation (never
// the address: "Email invitation", when it was sent and when it expires).
export type PendingInvite =
  | { kind: "inApp"; createdAt: number; invite: HouseholdSentInviteView }
  | { kind: "email"; createdAt: number; invite: EmailInviteView };

// In-app and email invitations together, newest first.
export function mergePendingInvites(
  inApp: readonly HouseholdSentInviteView[],
  email: readonly EmailInviteView[],
): PendingInvite[] {
  return [
    ...inApp.map((invite) => ({
      kind: "inApp" as const,
      createdAt: invite.createdAt,
      invite,
    })),
    ...email.map((invite) => ({
      kind: "email" as const,
      createdAt: invite.createdAt,
      invite,
    })),
  ].sort((a, b) => b.createdAt - a.createdAt);
}

// The admin's "Waiting for a response" on the Members tab: every invitation the household is
// still waiting on, in-app and by email, each with its kind and a confirmed Revoke. Rendered
// only once both lists have loaded (so rows don't jump), and not at all when nothing is pending.
// Email rows are the admin's own email invitations (invitations.listMine), absent when the
// deployment has email invites switched off.
export function HouseholdPendingList({
  inApp,
  onError,
}: {
  inApp: readonly HouseholdSentInviteView[];
  onError: (error: unknown) => void;
}) {
  const t = useTranslations("household.pending");
  const tEmail = useTranslations("emailInvite");
  const { data: emailAvailable } = useQuery(
    convexQuery(gateway.invitations.availability, {}),
  );
  const { data: email } = useQuery(
    convexQuery(
      gateway.invitations.listMine,
      emailAvailable === true ? { kind: "household" } : "skip",
    ),
  );

  const revokeInApp = useMutation({
    mutationFn: useConvexMutation(gateway.household.revokeInvite),
    onSuccess: () => toast.success(t("revoked")),
    onError,
  });
  const revokeEmail = useMutation({
    mutationFn: useConvexAction(gateway.invitations.revoke),
    onSuccess: () => toast.success(tEmail("revoked")),
    onError: () => toast.error(tEmail("revokeFailed")),
  });

  if (emailAvailable === undefined) return null;
  if (emailAvailable && email === undefined) return null;
  const rows = mergePendingInvites(inApp, email ?? []);
  if (rows.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{t("title")}</h3>
      <div className="space-y-1">
        <h4 className="text-muted-foreground text-xs font-medium">
          {t("invitesHeading", { count: rows.length })}
        </h4>
        <ul className="divide-y rounded-lg border px-4">
          {rows.map((row) =>
            row.kind === "inApp" ? (
              <InAppRow
                key={row.invite.inviteId}
                invite={row.invite}
                busy={revokeInApp.isPending}
                onRevoke={() =>
                  revokeInApp.mutate({ inviteId: row.invite.inviteId })
                }
              />
            ) : (
              <EmailRow
                key={row.invite.inviteRef}
                invite={row.invite}
                busy={revokeEmail.isPending}
                onRevoke={() =>
                  revokeEmail.mutate({ inviteRef: row.invite.inviteRef })
                }
              />
            ),
          )}
        </ul>
      </div>
    </section>
  );
}

function InAppRow({
  invite,
  busy,
  onRevoke,
}: {
  invite: HouseholdSentInviteView;
  busy: boolean;
  onRevoke: () => void;
}) {
  const t = useTranslations("household.pending");
  const displayName = useMemberDisplayName();
  const relativeTime = useRelativeTime();
  const name = displayName(invite.invitee);
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="h-9 w-9">
          <AvatarImage src={invite.invitee.avatar} alt="" />
          <AvatarFallback>
            <MemberInitial source={invite.invitee} />
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-muted-foreground text-xs">
            <Send aria-hidden className="mr-1 inline size-3" />
            {t("invitedInApp", { when: relativeTime(invite.createdAt) })}
          </p>
        </div>
      </div>
      <RevokeButton
        label={t("revokeInAppLabel", { name })}
        body={t("revokeInAppBody", { name })}
        busy={busy}
        onRevoke={onRevoke}
      />
    </li>
  );
}

function EmailRow({
  invite,
  busy,
  onRevoke,
}: {
  invite: EmailInviteView;
  busy: boolean;
  onRevoke: () => void;
}) {
  const t = useTranslations("household.pending");
  const tEmail = useTranslations("emailInvite");
  const format = useFormatter();
  const relativeTime = useRelativeTime();
  const when = relativeTime(invite.createdAt);
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full">
          <Mail aria-hidden className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{t("emailTitle")}</p>
          <p className="text-muted-foreground text-xs">
            {t("emailMeta", {
              when,
              date: format.dateTime(invite.expiresAt, { dateStyle: "medium" }),
            })}
          </p>
        </div>
      </div>
      <RevokeButton
        label={t("revokeEmailLabel", { when })}
        body={tEmail("revokeConfirmBody")}
        busy={busy}
        onRevoke={onRevoke}
      />
    </li>
  );
}

// Revoke with the same confirmation for both kinds; icon-only on phones (44px), labelled.
function RevokeButton({
  label,
  body,
  busy,
  onRevoke,
}: {
  label: string;
  body: string;
  busy: boolean;
  onRevoke: () => void;
}) {
  const tEmail = useTranslations("emailInvite");
  const tCommon = useTranslations("common");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          aria-label={label}
          className="text-destructive hover:text-destructive size-11 shrink-0 p-0 sm:h-8 sm:w-auto sm:px-3"
          disabled={busy}
        >
          <Undo2 aria-hidden className="h-4 w-4" />
          <span className="hidden sm:inline">{tEmail("revoke")}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tEmail("revokeConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={onRevoke}
          >
            {tEmail("revoke")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

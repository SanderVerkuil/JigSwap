// The invitee side of circle invitations: the "Invitations" section at the top of the circles
// page. Each row names the circle, who invited you (projected: an anonymised inviter renders as
// the generic member label), the circle's size and when the invite expires, with Accept and
// Decline. A `?invite=<id>` deep link (the circle_invite_received notification) scrolls to,
// highlights and focuses that row; when it is no longer pending a neutral toast says so.
import {
  circleInviteErrorKey,
  INVITE_UNAVAILABLE_KEY,
} from "@/components/circles/circle-invite-error";
import { CoverChip } from "@/components/community/primitives";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { Check, Users, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

export type MyCircleInvite = FunctionReturnType<
  typeof gateway.sharing.myInvites
>[number];

export function MyCircleInvitations({
  highlightInviteId,
}: {
  highlightInviteId?: string;
}) {
  const t = useTranslations("circles");
  const { data: invites } = useQuery(
    convexQuery(gateway.sharing.myInvites, {}),
  );

  const fail = (error: unknown) => {
    const key = circleInviteErrorKey(error);
    if (key === INVITE_UNAVAILABLE_KEY) toast(t(key));
    else toast.error(t(key));
  };
  const accept = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.acceptInvite),
    onError: fail,
  });
  const decline = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.declineInvite),
    onSuccess: () => toast(t("invitations.declined")),
    onError: fail,
  });

  // Check the deep-linked invite once, on the first load only: after Accept/Decline it leaves
  // the list too, and that must not read as "no longer available".
  const checkedRef = useRef(false);
  useEffect(() => {
    if (!highlightInviteId || invites === undefined || checkedRef.current) {
      return;
    }
    checkedRef.current = true;
    if (!invites.some((invite) => invite.inviteId === highlightInviteId)) {
      toast(t("invitations.unavailable"));
    }
  }, [highlightInviteId, invites, t]);

  if (!invites || invites.length === 0) return null;

  return (
    <CircleInvitationList
      invites={invites}
      highlightInviteId={highlightInviteId}
      busy={accept.isPending || decline.isPending}
      onAccept={(invite) =>
        accept.mutate(
          { inviteId: invite.inviteId },
          {
            onSuccess: () =>
              toast.success(
                t("invitations.accepted", { circle: invite.circleName }),
              ),
          },
        )
      }
      onDecline={(invite) => decline.mutate({ inviteId: invite.inviteId })}
    />
  );
}

export function CircleInvitationList({
  invites,
  highlightInviteId,
  busy = false,
  onAccept,
  onDecline,
}: {
  invites: MyCircleInvite[];
  highlightInviteId?: string;
  busy?: boolean;
  onAccept: (invite: MyCircleInvite) => void;
  onDecline: (invite: MyCircleInvite) => void;
}) {
  const t = useTranslations("circles");
  return (
    <section aria-labelledby="circle-invitations-title" className="mb-6">
      <h2
        id="circle-invitations-title"
        className="font-heading mb-2 text-lg font-bold"
      >
        {t("invitations.title")}
      </h2>
      <ul className="divide-y rounded-lg border px-4">
        {invites.map((invite, index) => (
          <CircleInvitationRow
            key={invite.inviteId}
            invite={invite}
            gradientIndex={index}
            highlighted={invite.inviteId === highlightInviteId}
            busy={busy}
            onAccept={() => onAccept(invite)}
            onDecline={() => onDecline(invite)}
          />
        ))}
      </ul>
    </section>
  );
}

function CircleInvitationRow({
  invite,
  gradientIndex,
  highlighted,
  busy,
  onAccept,
  onDecline,
}: {
  invite: MyCircleInvite;
  gradientIndex: number;
  highlighted: boolean;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const t = useTranslations("circles");
  const format = useFormatter();
  const displayName = useMemberDisplayName();
  const rowRef = useRef<HTMLLIElement>(null);

  // Bring the deep-linked invite into view and move focus to it so keyboard and screen-reader
  // users start there.
  useEffect(() => {
    const row = rowRef.current;
    if (!highlighted || !row) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    row.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center",
    });
    row.focus({ preventScroll: true });
  }, [highlighted]);

  const inviter = displayName(
    invite.inviter.anonymous ? null : invite.inviter.member,
  );

  return (
    <li
      ref={rowRef}
      tabIndex={highlighted ? -1 : undefined}
      data-highlighted={highlighted || undefined}
      aria-labelledby={`circle-invite-${invite.inviteId}`}
      className={cn(
        "flex flex-col gap-3 py-3 outline-none sm:flex-row sm:items-center",
        highlighted &&
          "bg-jigsaw-primary/5 ring-jigsaw-primary/40 -mx-3 rounded-lg px-3 ring-2",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <CoverChip icon={Users} size={40} gradientIndex={gradientIndex} />
        <div className="min-w-0">
          <p
            id={`circle-invite-${invite.inviteId}`}
            className="truncate font-medium"
          >
            {invite.circleName}
          </p>
          <p className="text-muted-foreground text-sm">
            {t("invitations.invitedBy", { name: inviter })}
            {" · "}
            {invite.memberCount}{" "}
            {t("membersLabel", { count: invite.memberCount })}
            {" · "}
            {t("invitations.expires", {
              date: format.dateTime(invite.expiresAt, { dateStyle: "medium" }),
            })}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:justify-end">
        <Button size="sm" variant="brand" disabled={busy} onClick={onAccept}>
          <Check className="h-4 w-4" />
          {t("invitations.accept")}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onDecline}>
          <X className="h-4 w-4" />
          {t("invitations.decline")}
        </Button>
      </div>
    </li>
  );
}

// "Invite by email" for someone not on JigSwap yet (spec E.1): a follow invite on the People
// page and the quick start, a household invite for the household admin. The answer to a send is
// always the same "Invitation sent", whether or not the address has an account, and the address
// is never shown again: the pending list reads "Invitation sent {when}" with no address or name.
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
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { gateway } from "@/gateway";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { convexQuery, useConvexAction } from "@convex-dev/react-query";
import type { EmailInviteKind, EmailInviteView } from "@jigswap/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ConvexError } from "convex/values";
import { Mail, Undo2 } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

// Why a send failed, as the UI explains it: the address is malformed, the inviter hit the daily
// limit (with when they can try again), or anything else (a generic retry).
export type EmailInviteError =
  | { kind: "invalidEmail" }
  | { kind: "rateLimited"; retryAt: number }
  | { kind: "generic" };

export function emailInviteError(
  error: unknown,
  now: number,
): EmailInviteError {
  if (error instanceof ConvexError) {
    const data = error.data as
      { code?: unknown; retryAfterMs?: unknown } | undefined;
    if (data?.code === "InvalidEmail") return { kind: "invalidEmail" };
    if (data?.code === "RateLimited" && typeof data.retryAfterMs === "number") {
      return { kind: "rateLimited", retryAt: now + data.retryAfterMs };
    }
  }
  return { kind: "generic" };
}

// The whole entry point: nothing at all (not even the optional heading) unless the deployment has
// email invites switched on.
export function EmailInvite({
  kind,
  heading,
}: {
  kind: EmailInviteKind;
  heading?: ReactNode;
}) {
  const { data: available } = useQuery(
    convexQuery(gateway.invitations.availability, {}),
  );
  if (available !== true) return null;
  return (
    <div className="space-y-3">
      {heading}
      <EmailInviteForm kind={kind} />
      <EmailInviteListContainer kind={kind} />
    </div>
  );
}

export function EmailInviteForm({ kind }: { kind: EmailInviteKind }) {
  const t = useTranslations("emailInvite");
  const relativeTime = useRelativeTime();
  const inputId = useId();
  const [email, setEmail] = useState("");
  const [outcome, setOutcome] = useState<
    { kind: "sent" } | EmailInviteError | null
  >(null);

  const send = useMutation({
    mutationFn: useConvexAction(gateway.invitations.send),
    onSuccess: () => {
      setEmail("");
      setOutcome({ kind: "sent" });
    },
    onError: (error) => setOutcome(emailInviteError(error, Date.now())),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (email.trim() === "" || send.isPending) return;
    setOutcome(null);
    send.mutate({ kind, email });
  };

  const message =
    outcome === null
      ? ""
      : outcome.kind === "sent"
        ? t("sent")
        : outcome.kind === "rateLimited"
          ? t("errors.rateLimited", { when: relativeTime(outcome.retryAt) })
          : t(`errors.${outcome.kind}`);

  return (
    <form className="space-y-2" noValidate onSubmit={submit}>
      <Label htmlFor={inputId}>{t("emailLabel")}</Label>
      <div className="flex max-w-xl flex-wrap gap-2">
        <Input
          id={inputId}
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("emailPlaceholder")}
          className="min-w-0 flex-1 basis-56"
        />
        <Button
          type="submit"
          variant="outline"
          className="pointer-coarse:min-h-11"
          disabled={email.trim() === "" || send.isPending}
        >
          <Mail className="size-4" />
          {t("submit")}
        </Button>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={
          outcome && outcome.kind !== "sent"
            ? "text-destructive text-sm"
            : "text-sm"
        }
      >
        {message}
      </p>
      <p className="text-muted-foreground text-xs">{t("note")}</p>
    </form>
  );
}

function EmailInviteListContainer({ kind }: { kind: EmailInviteKind }) {
  const t = useTranslations("emailInvite");
  const { data: invites } = useQuery(
    convexQuery(gateway.invitations.listMine, { kind }),
  );
  const revoke = useMutation({
    mutationFn: useConvexAction(gateway.invitations.revoke),
    onSuccess: () => toast.success(t("revoked")),
    onError: () => toast.error(t("revokeFailed")),
  });
  if (!invites || invites.length === 0) return null;
  return (
    <EmailInviteList
      invites={invites}
      busy={revoke.isPending}
      onRevoke={(inviteRef) => revoke.mutate({ inviteRef })}
    />
  );
}

export function EmailInviteList({
  invites,
  busy = false,
  onRevoke,
}: {
  invites: readonly EmailInviteView[];
  busy?: boolean;
  onRevoke: (inviteRef: string) => void;
}) {
  const t = useTranslations("emailInvite");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const relativeTime = useRelativeTime();

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">{t("pendingTitle")}</h4>
      <ul className="divide-y rounded-lg border px-4">
        {invites.map((invite) => (
          <li
            key={invite.inviteRef}
            className="flex items-center justify-between gap-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm">
                {t("pendingSent", { when: relativeTime(invite.createdAt) })}
              </p>
              <p className="text-muted-foreground text-xs">
                {t("pendingExpires", {
                  date: format.dateTime(invite.expiresAt, {
                    dateStyle: "medium",
                  }),
                })}
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive shrink-0 pointer-coarse:min-h-11"
                  disabled={busy}
                >
                  <Undo2 className="h-4 w-4" />
                  {t("revoke")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("revokeConfirmTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("revokeConfirmBody")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    className={buttonVariants({ variant: "destructive" })}
                    onClick={() => onRevoke(invite.inviteRef)}
                  >
                    {t("revoke")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { gateway } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Copy, QrCode, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// Fullscreen "show my QR" dialog. The QR encodes the STABLE member-id URL (rename-proof) with the
// invite token; the mono caption shows the member's canonical profile URL, and a hint says that the
// code, Copy link and Share carry the personal invite link rather than that address. The QR card
// is always white — dark mode must never invert the modules or phone cameras stop reading it.
const DIALOG_CONTENT_CLASS =
  "flex h-svh max-h-svh w-full max-w-full flex-col items-center justify-center gap-6 rounded-none sm:h-auto sm:max-h-[90svh] sm:max-w-md sm:rounded-lg";

type QrDialogProps = {
  memberId: string;
  // The member's raw account name (may be absent); resolved via useMemberDisplayName with the
  // username fallback — never the email, since the QR card is shown to other people.
  displayName?: string;
  username: string | null | undefined;
  // The member's canonical /members/<handle> (CurrentMemberView.handle), for the caption. Never
  // built from `username`: another member may hold that string as a slug (SEC-07).
  handle: string | undefined;
  avatarUrl?: string | null;
};

// Shared body: the username-gate prompt, OR the QR card. The gate comes first so a member without
// a username never mints an invite token; the fetch lives in QrCard, which mounts only past it.
// `onNavigate` closes the enclosing dialog when the username-gate link routes away — otherwise the
// dialog lingers open over the settings page (whose route can be the same one it navigates to).
function QrDialogContent(props: QrDialogProps & { onNavigate?: () => void }) {
  const t = useTranslations("invite");

  if (props.username == null) {
    return (
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <h2 className="font-heading text-xl">{t("needUsernameTitle")}</h2>
        <p className="text-muted-foreground text-sm">{t("needUsernameBody")}</p>
        <Button asChild variant="brand">
          <Link to="/profile" onClick={props.onNavigate}>
            {t("openSettings")}
          </Link>
        </Button>
      </div>
    );
  }

  return <QrCard {...props} username={props.username} />;
}

// Avatar + name, the QR card, the mono caption, the copy/share actions and what they send. Fetches
// (and caches for the lifetime of this mount) the member's invite token — mounted fresh each time
// the dialog opens (Radix unmounts DialogContent while closed), so a plain mount effect is enough;
// no `open` prop needed here.
function QrCard(props: QrDialogProps & { username: string }) {
  const t = useTranslations("invite");
  const displayName = useMemberDisplayName();
  const nameSource = { name: props.displayName, username: props.username };
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const { mutate: fetchLink, data: link } = useMutation({
    mutationFn: useConvexMutation(gateway.social.myInviteLink),
  });

  useEffect(() => {
    fetchLink({});
  }, [fetchLink]);

  // No "Copied" reset may fire after the dialog closed.
  useEffect(() => {
    const timer = copiedTimer;
    return () => clearTimeout(timer.current);
  }, []);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const qrUrl = link
    ? `${origin}/members/${props.memberId}?invite=${link.token}`
    : null;
  const displayUrl = props.handle
    ? `${origin.replace(/^https?:\/\//, "")}/members/${encodeURIComponent(props.handle)}`
    : null;

  // "Copied" only once the clipboard accepted the link; a refusal (permissions, insecure context,
  // no clipboard API) says so instead.
  const copy = async () => {
    if (!qrUrl) return;
    try {
      await navigator.clipboard.writeText(qrUrl);
    } catch {
      toast.error(t("copyError"));
      return;
    }
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <>
      <div className="flex flex-col items-center gap-2">
        <Avatar className="size-16">
          {props.avatarUrl ? <AvatarImage src={props.avatarUrl} /> : null}
          <AvatarFallback>
            <MemberInitial source={nameSource} />
          </AvatarFallback>
        </Avatar>
        <span className="font-heading text-lg">{displayName(nameSource)}</span>
      </div>
      {/* Always-white card: ≥16px padding is the QR quiet zone. */}
      <div className="rounded-2xl bg-white p-5 shadow-md">
        {qrUrl ? (
          <QRCodeSVG
            value={qrUrl}
            size={320}
            className="h-auto w-[min(70vw,320px)]"
            bgColor="#ffffff"
            fgColor="#000000"
          />
        ) : (
          <div className="size-[min(70vw,320px)]" />
        )}
      </div>
      {displayUrl ? (
        <span className="text-muted-foreground font-mono text-sm">
          {displayUrl}
        </span>
      ) : null}
      <p className="text-muted-foreground text-sm">{t("scanHint")}</p>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => void copy()} disabled={!qrUrl}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? t("copied") : t("copyLink")}
        </Button>
        {canShare ? (
          <Button
            variant="brand"
            disabled={!qrUrl}
            onClick={() => {
              // A dismissed share sheet rejects; that is fine.
              if (qrUrl) navigator.share({ url: qrUrl }).catch(() => {});
            }}
          >
            <Share2 className="size-4" />
            {t("share")}
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground max-w-sm text-center text-xs">
        {t("inviteLinkHint")}
      </p>
      {/* The button label swaps to "Copied!"; this live region announces it. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? t("copied") : ""}
      </span>
    </>
  );
}

// Self-contained trigger button + dialog: `Show my QR` opens the fullscreen QR view.
export function QrDialog(props: QrDialogProps) {
  const t = useTranslations("invite");
  // Controlled so the username-gate link can close the dialog before it routes to /profile —
  // otherwise it would linger open over the settings page.
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <QrCode className="size-4" />
          {t("showMyQr")}
        </Button>
      </DialogTrigger>
      <DialogContent className={DIALOG_CONTENT_CLASS}>
        <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>
        <QrDialogContent {...props} onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

// Controlled-open variant for the post-signup loop-closure nudge (Task 10): a visible
// heading/body line above the shared QR body, no trigger — closing the dialog any way (the X,
// Escape, overlay click, or the skip button) calls onClose.
export function QrDialogAutoOpen(
  props: QrDialogProps & {
    title: string;
    body: string;
    onClose: () => void;
  },
) {
  const t = useTranslations("invite");

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className={DIALOG_CONTENT_CLASS}>
        <DialogTitle className="font-heading text-xl">
          {props.title}
        </DialogTitle>
        <p className="text-muted-foreground text-sm">{props.body}</p>
        <QrDialogContent {...props} onNavigate={props.onClose} />
        <Button variant="ghost" onClick={props.onClose}>
          {t("loopSkip")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

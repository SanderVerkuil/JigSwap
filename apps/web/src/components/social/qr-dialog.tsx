import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Copy, QrCode, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

// Fullscreen "show my QR" dialog. The QR encodes the STABLE member-id URL (rename-proof) with the
// invite token; the mono caption shows the human-readable username URL. The QR card is always
// white — dark mode must never invert the modules or phone cameras stop reading it.
const DIALOG_CONTENT_CLASS =
  "flex h-svh max-h-svh w-full max-w-full flex-col items-center justify-center gap-6 rounded-none sm:h-auto sm:max-h-[90svh] sm:max-w-md sm:rounded-lg";

type QrDialogProps = {
  memberId: string;
  displayName: string;
  username: string | null | undefined;
  avatarUrl?: string | null;
};

// Shared body: the username-gate prompt, OR avatar + name, the QR card, the mono caption, and the
// copy/share actions. Fetches (and caches for the lifetime of this mount) the member's invite
// token — mounted fresh each time the dialog opens (Radix unmounts DialogContent while closed), so
// a plain mount effect is enough; no `open` prop needed here.
function QrDialogContent(props: QrDialogProps) {
  const t = useTranslations("invite");
  const [copied, setCopied] = useState(false);

  const { mutate: fetchLink, data: link } = useMutation({
    mutationFn: useConvexMutation(gateway.social.myInviteLink),
  });

  useEffect(() => {
    fetchLink({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const qrUrl = link
    ? `${origin}/members/${props.memberId}?invite=${link.token}`
    : null;
  const displayUrl = props.username
    ? `${origin.replace(/^https?:\/\//, "")}/members/${props.username}`
    : null;

  const copy = () => {
    if (!qrUrl) return;
    void navigator.clipboard.writeText(qrUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  if (props.username == null) {
    return (
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <h2 className="font-heading text-xl">{t("needUsernameTitle")}</h2>
        <p className="text-muted-foreground text-sm">{t("needUsernameBody")}</p>
        <Button asChild variant="brand">
          <Link to="/profile">{t("openSettings")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col items-center gap-2">
        <Avatar className="size-16">
          {props.avatarUrl ? <AvatarImage src={props.avatarUrl} /> : null}
          <AvatarFallback>{props.displayName.slice(0, 2)}</AvatarFallback>
        </Avatar>
        <span className="font-heading text-lg">{props.displayName}</span>
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
        <Button variant="outline" onClick={copy} disabled={!qrUrl}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? t("copied") : t("copyLink")}
        </Button>
        {canShare ? (
          <Button
            variant="brand"
            disabled={!qrUrl}
            onClick={() => {
              if (qrUrl) void navigator.share({ url: qrUrl });
            }}
          >
            <Share2 className="size-4" />
            {t("share")}
          </Button>
        ) : null}
      </div>
    </>
  );
}

// Self-contained trigger button + dialog: `Show my QR` opens the fullscreen QR view.
export function QrDialog(props: QrDialogProps) {
  const t = useTranslations("invite");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <QrCode className="size-4" />
          {t("showMyQr")}
        </Button>
      </DialogTrigger>
      <DialogContent className={DIALOG_CONTENT_CLASS}>
        <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>
        <QrDialogContent {...props} />
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
        <QrDialogContent {...props} />
        <Button variant="ghost" onClick={props.onClose}>
          {t("loopSkip")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

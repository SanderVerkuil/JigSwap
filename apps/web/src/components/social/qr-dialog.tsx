import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LoadingSpinner } from "@/components/ui/loading";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { CUSTOM_LINK_FIELD_ID } from "@/lib/profile-search";
import { Link } from "@tanstack/react-router";
import { QrCode, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { CopyLinkButton } from "./copy-link-button";
import { InviteLinkError } from "./invite-link-error";
import { useMyInviteLink } from "./use-my-invite-link";

// Fullscreen "show my QR" dialog. The QR encodes the STABLE member-id URL (rename-proof) with the
// invite token, so it works for every member, username or not. The mono caption shows the member's
// canonical profile URL when that reads as a name, and a hint says that the code, Copy link and
// Share carry the personal invite link rather than that address. The QR card is always white —
// dark mode must never invert the modules or phone cameras stop reading it.
const DIALOG_CONTENT_CLASS =
  "flex h-svh max-h-svh w-full max-w-full flex-col justify-start rounded-none sm:h-auto sm:max-h-[90svh] sm:max-w-md sm:rounded-lg";
// Centred by its own auto margins, not justify-center on the dialog: when the content is taller than
// a short phone, that centring pushes the top out of the scroll area for good.
const DIALOG_BODY_CLASS = "my-auto flex w-full flex-col items-center gap-6";

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

// Avatar + name, the QR card, the mono caption, the copy/share actions and what they send. Fetches
// (and caches for the lifetime of this mount) the member's invite token — mounted fresh each time
// the dialog opens (Radix unmounts DialogContent while closed), so a plain mount effect is enough;
// no `open` prop needed here. `onNavigate` closes the enclosing dialog when the custom-link prompt
// routes away — otherwise the dialog lingers open over the page (which can be the one it opened on).
function QrCard(props: QrDialogProps & { onNavigate?: () => void }) {
  const t = useTranslations("invite");
  const tCommon = useTranslations("common");
  const displayName = useMemberDisplayName();
  const nameSource = { name: props.displayName, username: props.username };
  const { url: qrUrl, failed, refetch } = useMyInviteLink(props.memberId);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  // A bare member id is no address to show anyone: without a readable handle the caption goes.
  const readableHandle =
    props.handle !== props.memberId ? props.handle : undefined;
  const displayUrl = readableHandle
    ? `${origin.replace(/^https?:\/\//, "")}/members/${encodeURIComponent(readableHandle)}`
    : null;

  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <>
      <div className="flex max-w-full flex-col items-center gap-2">
        <Avatar className="size-16">
          {props.avatarUrl ? <AvatarImage src={props.avatarUrl} /> : null}
          <AvatarFallback>
            <MemberInitial source={nameSource} />
          </AvatarFallback>
        </Avatar>
        <span className="font-heading max-w-full text-center text-lg [overflow-wrap:anywhere]">
          {displayName(nameSource)}
        </span>
      </div>
      {failed ? (
        <InviteLinkError
          onRetry={refetch}
          className="items-center text-center"
        />
      ) : (
        <>
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
              <div
                role="status"
                aria-label={tCommon("loading")}
                className="grid size-[min(70vw,320px)] place-items-center text-neutral-500"
              >
                <LoadingSpinner size="lg" />
              </div>
            )}
          </div>
          {displayUrl ? (
            <span className="text-muted-foreground max-w-full text-center font-mono text-sm break-all">
              {displayUrl}
            </span>
          ) : null}
          <p className="text-muted-foreground text-center text-sm">
            {t("scanHint")}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <CopyLinkButton url={qrUrl} />
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
          {!readableHandle && (
            <div className="flex max-w-sm flex-col items-center gap-1 text-center">
              <p className="text-muted-foreground text-xs">
                {t("customLinkNote")}
              </p>
              <Button asChild variant="ghost" size="sm">
                <Link
                  to="/profile"
                  search={{ edit: "link" }}
                  onClick={props.onNavigate}
                >
                  {t("setCustomLink")}
                </Link>
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

// Self-contained trigger button + dialog: `Show my QR` opens the fullscreen QR view.
export function QrDialog(props: QrDialogProps) {
  const t = useTranslations("invite");
  // Controlled so the custom-link prompt can close the dialog before it routes to /profile —
  // otherwise it would linger open over that page.
  const [open, setOpen] = useState(false);
  const choseCustomLink = useRef(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <QrCode className="size-4" />
          {t("showMyQr")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className={DIALOG_CONTENT_CLASS}
        onCloseAutoFocus={(event) => {
          if (!choseCustomLink.current) return;
          choseCustomLink.current = false;
          // With the field already open the URL may not change (/profile?edit=link), so nothing
          // else moves focus. Without it, the form focuses its field itself when it mounts.
          const field = document.getElementById(CUSTOM_LINK_FIELD_ID);
          if (!field) return;
          event.preventDefault();
          field.focus();
        }}
      >
        <div className={DIALOG_BODY_CLASS}>
          <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>
          <QrCard
            {...props}
            onNavigate={() => {
              choseCustomLink.current = true;
              setOpen(false);
            }}
          />
        </div>
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
        <div className={DIALOG_BODY_CLASS}>
          <DialogTitle className="font-heading text-xl">
            {props.title}
          </DialogTitle>
          <p className="text-muted-foreground text-center text-sm">
            {props.body}
          </p>
          <QrCard {...props} onNavigate={props.onClose} />
          <Button variant="ghost" onClick={props.onClose}>
            {t("loopSkip")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

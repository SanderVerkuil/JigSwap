import { Button } from "@/components/ui/button";
import { Check, Copy, Mail, MessageCircle, Share2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "use-intl";
import { canWebShare, mailtoUrl, whatsAppUrl } from "./invite-share";

// The invite share sheet (decision 2): the member sends their invite link from their OWN device.
// Web Share when the browser has it, and always copy-link, Email (mailto with no address) and
// WhatsApp (click-to-chat with no number). JigSwap never sees who it goes to.
type InviteShareProps = {
  // The full landing URL with the token; null while it is still being fetched.
  url: string | null;
  // Which message to prefill: the network link ("follow each other") or a household link.
  kind: "network" | "household";
};

const noopSubscribe = () => () => {};

// Web Share support, read without a hydration mismatch: false on the server and on the first
// client render, then the real value.
const useCanWebShare = (): boolean =>
  useSyncExternalStore(
    noopSubscribe,
    () => canWebShare(navigator),
    () => false,
  );

export function InviteShareActions(props: InviteShareProps) {
  return <InviteShareButtons {...props} canShare={useCanWebShare()} />;
}

// Presentational body, with Web Share support passed in so both states can be rendered in tests.
export function InviteShareButtons({
  url,
  kind,
  canShare,
}: InviteShareProps & { canShare: boolean }) {
  const t = useTranslations("inviteShare");
  const tInvite = useTranslations("invite");
  const [copied, setCopied] = useState(false);

  const subject = t("subject");
  const message = url
    ? t(kind === "household" ? "householdMessage" : "message", { url })
    : "";

  const copy = () => {
    if (!url) return;
    void navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const share = () => {
    // The URL is part of the message text, so it is not passed again as `url` (most share
    // targets would append it a second time). A dismissed share sheet rejects; that is fine.
    if (url) navigator.share({ title: subject, text: message }).catch(() => {});
  };

  const fallback = "pointer-coarse:min-h-11";

  return (
    <div className="flex flex-col gap-3">
      {canShare ? (
        <Button
          className="bg-jigsaw-primary hover:bg-jigsaw-primary/90 w-full text-white sm:w-auto sm:self-start pointer-coarse:min-h-11"
          disabled={!url}
          onClick={share}
        >
          <Share2 className="size-4" />
          {t("share")}
        </Button>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className={fallback}
          disabled={!url}
          onClick={copy}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? tInvite("copied") : tInvite("copyLink")}
        </Button>
        {url ? (
          <>
            <Button asChild variant="outline" className={fallback}>
              <a href={mailtoUrl({ subject, body: message })}>
                <Mail className="size-4" />
                {t("email")}
              </a>
            </Button>
            <Button asChild variant="outline" className={fallback}>
              <a
                href={whatsAppUrl(message)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="size-4" />
                {t("whatsapp")}
              </a>
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" className={fallback} disabled>
              <Mail className="size-4" />
              {t("email")}
            </Button>
            <Button variant="outline" className={fallback} disabled>
              <MessageCircle className="size-4" />
              {t("whatsapp")}
            </Button>
          </>
        )}
      </div>
      {/* The button label swaps to "Copied!"; this live region announces it. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? tInvite("copied") : ""}
      </span>
      <p className="text-muted-foreground text-xs">{t("privacy")}</p>
    </div>
  );
}

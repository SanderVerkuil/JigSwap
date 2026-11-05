import { InviteShareActions } from "@/components/social/invite-share-actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { gateway } from "@/gateway";
import { sharedCopyUrl } from "@/lib/shared-copy-link";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";

// "Send a link" for a copy on offer: the member sends its page from their own device (Web Share,
// Copy link, Email, WhatsApp), the same share sheet as the invite link, so JigSwap never sees who
// it goes to. Sending it to one person is the point (a sister, a friend); someone without an account
// signs up first and lands here afterwards. An owner with a private profile is told who can open it
// (canViewCopy decides, not the link); a co-manager's own profile says nothing about the owner's.
export function SendCopyLinkDialog({
  copyId,
  title,
  viewerIsOwner,
  open,
  onOpenChange,
}: {
  copyId: string;
  title: string;
  viewerIsOwner: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("copyInstance.sendLink");
  const { data: profile } = useQuery(
    convexQuery(gateway.social.profile, open && viewerIsOwner ? {} : "skip"),
  );
  // The dialog only opens in the browser, so `window` is defined whenever the url is read.
  const url = open ? sharedCopyUrl(window.location.origin, copyId) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { title })}</DialogDescription>
        </DialogHeader>
        {profile?.visibility === "private" && (
          <p className="text-muted-foreground text-sm">{t("privateNote")}</p>
        )}
        <InviteShareActions url={url} kind="puzzle" puzzleTitle={title} />
      </DialogContent>
    </Dialog>
  );
}

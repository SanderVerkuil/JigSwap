import { HouseholdInviteLink } from "@/components/household/household-invite-link";
import { HouseholdMemberInvite } from "@/components/household/household-member-invite";
import { EmailInvite } from "@/components/social/email-invite";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useTranslations } from "use-intl";

// The household page's one "Invite" entry point (admin only): the three existing invite methods,
// unchanged, in order of likelihood — find a member already on JigSwap, share a link, or email
// someone who isn't. Each component keeps its own behaviour and feedback; the quick start reuses
// the same components directly.
export function HouseholdInviteDialog({
  open,
  onOpenChange,
  memberId,
  excludedIds,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The viewer (the admin): the invite link's landing page is theirs.
  memberId: string;
  // Members and pending invitees: never offered again.
  excludedIds: ReadonlySet<string>;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations("household.invite");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("dialogSub")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-5">
          <section className="space-y-3">
            <h3 className="text-sm font-medium">{t("searchHeading")}</h3>
            <HouseholdMemberInvite
              excludedIds={excludedIds}
              onError={onError}
            />
          </section>
          <Separator />
          <HouseholdInviteLink memberId={memberId} />
          <EmailInvite
            kind="household"
            heading={
              <>
                <Separator className="mb-5" />
                <h3 className="text-sm font-medium">{t("emailHeading")}</h3>
              </>
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

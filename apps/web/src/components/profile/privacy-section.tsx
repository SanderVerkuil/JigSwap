"use client";

import { SegmentedPills } from "@/components/add-puzzle/segmented-pills";
import { SectionHead } from "@/components/dashboard-home/section-head";
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
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { convexErrorCode } from "@/lib/convex-error-code";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RotateCcw, Shield } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

type Visibility = "public" | "private";

/** The anchor other surfaces link to (/profile#privacy). */
export const PRIVACY_SECTION_ID = "privacy";

// The always-visible privacy controls on /profile. Everything here saves the
// moment it is chosen (no Save button), which is why it lives outside the
// Edit Profile form: that form saves its fields together on Save, and Cancel
// drops them. Visibility uses the same Everyone / Only people you approve
// choice as quick start, states what each setting means, and its toast offers
// an Undo that writes the previous value back.
export function PrivacySection() {
  const t = useTranslations("profile.privacy");
  const tChoice = useTranslations("quickStart.profile");
  const { data: socialProfile } = useQuery(
    convexQuery(gateway.social.profile, {}),
  );
  // The raw Convex mutation function: the toast's Undo can fire after the
  // member has left /profile, when no react-query observer is mounted.
  const setVisibility = useConvexMutation(gateway.social.setProfileVisibility);
  const change = useMutation({ mutationFn: setVisibility });

  // No Social profile yet (null) means the public default.
  const stored: Visibility = socialProfile?.visibility ?? "public";
  // The choice shows at once; the live profile takes over when the write lands
  // (and on a failed write, the stored value simply comes back).
  const shown = change.isPending ? change.variables.visibility : stored;
  const savedMessage = (visibility: Visibility) =>
    visibility === "private" ? t("nowPrivate") : t("nowPublic");
  // More changes in an hour than the server takes (backend lib/rateLimits profileVisibility).
  const failureMessage = (error: unknown) =>
    t(convexErrorCode(error) === "RateLimited" ? "rateLimited" : "saveError");

  const undo = async (previous: Visibility) => {
    try {
      await setVisibility({ visibility: previous });
      toast.success(savedMessage(previous));
    } catch (error) {
      toast.error(failureMessage(error));
    }
  };

  const choose = async (next: Visibility) => {
    if (next === shown) return;
    const previous = shown;
    try {
      await change.mutateAsync({ visibility: next });
      toast.success(savedMessage(next), {
        action: { label: t("undo"), onClick: () => void undo(previous) },
      });
    } catch (error) {
      toast.error(failureMessage(error));
    }
  };

  return (
    <section
      id={PRIVACY_SECTION_ID}
      data-tour="profile-privacy"
      // Land below the sticky page head / mobile top bar when deep-linked. Each row puts its
      // control beside the explanation only when the section itself is wide enough.
      className="@container/privacy scroll-mt-[calc(var(--app-sticky-top,0px)+1rem)]"
    >
      <SectionHead title={t("title")} icon={Shield} />
      <div className="divide-y">
        <div className="flex flex-col gap-3 pb-5 @2xl/privacy:flex-row @2xl/privacy:items-start @2xl/privacy:justify-between @2xl/privacy:gap-6">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{tChoice("visibility")}</p>
            {socialProfile !== undefined && (
              <p className="text-muted-foreground text-sm">
                {shown === "private" ? t("privateStatus") : t("publicStatus")}
              </p>
            )}
          </div>
          {socialProfile === undefined ? (
            <Skeleton className="h-10 w-72 max-w-full shrink-0" />
          ) : (
            <div className="shrink-0" aria-busy={change.isPending}>
              <SegmentedPills
                ariaLabel={tChoice("visibility")}
                value={shown}
                onChange={(next) => void choose(next)}
                options={[
                  { value: "public", label: tChoice("public") },
                  { value: "private", label: tChoice("private") },
                ]}
              />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 pt-5 @2xl/privacy:flex-row @2xl/privacy:items-start @2xl/privacy:justify-between @2xl/privacy:gap-6">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{t("inviteLink")}</p>
            <p className="text-muted-foreground text-sm">
              {t("inviteLinkHelp")}
            </p>
          </div>
          <ResetInviteLinkButton />
        </div>
      </div>
    </section>
  );
}

// Revokes the member's QR / invite link and issues a new one, after a confirm:
// links and QR codes already shared stop working.
function ResetInviteLinkButton() {
  const t = useTranslations("profile.privacy");
  const tInvite = useTranslations("invite");
  const tCommon = useTranslations("common");
  const resetLink = useMutation({
    mutationFn: useConvexMutation(gateway.social.resetInviteLink),
  });

  const reset = async () => {
    try {
      await resetLink.mutateAsync({});
      toast.success(t("resetDone"));
    } catch {
      toast.error(t("resetError"));
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          className="shrink-0 self-start"
          disabled={resetLink.isPending}
        >
          <RotateCcw aria-hidden />
          {tInvite("resetLink")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("resetConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("resetConfirmBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={() => void reset()}
          >
            {t("resetConfirmAction")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

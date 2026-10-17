import {
  inviteLandingUrl,
  inviteLinkErrorKey,
} from "@/components/social/invite-share";
import { InviteShareActions } from "@/components/social/invite-share-actions";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// "Invite with a link" for the household admin: mints a single-use, 14-day household link
// (social.createHouseholdInviteLink) and hands it to the share sheet. Whoever signs up through
// it gets a pending household invite to accept; nobody is added automatically.
export function HouseholdInviteLink({
  memberId,
  onShared,
}: {
  memberId: string;
  // Called on any share action (the quick start's push-prompt trigger).
  onShared?: () => void;
}) {
  const t = useTranslations("inviteShare");

  const create = useMutation({
    mutationFn: useConvexMutation(gateway.social.createHouseholdInviteLink),
    onError: (error) => toast.error(t(inviteLinkErrorKey(error))),
  });
  const revoke = useMutation({
    mutationFn: useConvexMutation(gateway.social.revokeHouseholdInviteLinks),
    onSuccess: ({
      revoked,
    }: FunctionReturnType<
      typeof gateway.social.revokeHouseholdInviteLinks
    >) => {
      create.reset();
      toast.success(t("revoked", { count: revoked }));
    },
    onError: () => toast.error(t("revokeFailed")),
  });

  // Only set after a client-side mutation, so `window` is always defined here.
  const url = create.data
    ? inviteLandingUrl(window.location.origin, memberId, create.data.token)
    : null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">{t("inviteLink")}</h3>
      {url ? (
        <InviteShareActions url={url} kind="household" onShared={onShared} />
      ) : (
        <Button
          variant="outline"
          className="pointer-coarse:min-h-11"
          disabled={create.isPending}
          onClick={() => create.mutate({})}
        >
          <Link2 className="size-4" />
          {t("createLink")}
        </Button>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-muted-foreground text-xs">{t("linkNote")}</p>
        <Button
          variant="ghost"
          size="sm"
          className="pointer-coarse:min-h-11"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate({})}
        >
          {t("revokeLinks")}
        </Button>
      </div>
    </div>
  );
}

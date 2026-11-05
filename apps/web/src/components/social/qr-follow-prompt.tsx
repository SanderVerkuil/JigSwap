import { Button } from "@/components/ui/button";
import { gateway, type Id } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

type QrFollowResult = FunctionReturnType<typeof gateway.social.acceptQrFollow>;
type FollowRelation = FunctionReturnType<typeof gateway.social.followRelation>;

// What a scan would do for this viewer, decided by social/acceptQrFollow's rule: a private owner
// who doesn't follow the viewer gets a follow request, anyone else a mutual follow. null when the
// tap would change nothing: the viewer already follows that private owner or has a request waiting
// on them, the two already follow each other, or the viewer blocked the owner.
export const qrFollowMode = (
  relation: FollowRelation,
): "mutual" | "request" | null => {
  if (relation.blockedByMe) return null;
  if (relation.targetIsPrivate && !relation.followsYou) {
    return relation.following || relation.pendingRequest !== null
      ? null
      : "request";
  }
  return relation.following && relation.followsYou ? null : "mutual";
};

// Which toast a scan earns: a new follow, a follow request sent, or nothing (own, invalid or
// refused token, or nothing new to do).
export const qrFollowToastKey = (
  result: QrFollowResult,
): "followEstablished" | "followRequestSent" | null =>
  result.established
    ? "followEstablished"
    : result.requested
      ? "followRequestSent"
      : null;

// Shown when a signed-in viewer lands on someone's profile through their live network invite
// token (the meetup QR-scan case). The copy promises what the server will do (qrFollowMode, from
// the same followRelation read the profile's Follow button uses): one tap follows each other, or
// on a private profile only sends a follow request. The toast reports what the server did.
export function QrFollowPrompt({
  token,
  name,
  memberId,
}: {
  token: string;
  name: string;
  memberId: Id<"users">;
}) {
  const t = useTranslations("invite");
  const { data: relation } = useQuery(
    convexQuery(gateway.social.followRelation, { memberId }),
  );
  const { mutate, isPending } = useMutation({
    mutationFn: useConvexMutation(gateway.social.acceptQrFollow),
    onSuccess: (result: QrFollowResult) => {
      const key = qrFollowToastKey(result);
      if (key) toast.success(t(key, { name }));
    },
  });
  const mode = relation === undefined ? null : qrFollowMode(relation);
  if (mode === null) return null;
  return (
    <div className="border-jigsaw-primary/20 bg-jigsaw-primary/5 mb-6 flex w-full flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground text-sm">
        {mode === "request"
          ? t("requestFollowPrompt", { name })
          : t("followEachOther", { name })}
      </p>
      <Button
        size="sm"
        disabled={isPending}
        onClick={() => mutate({ token })}
        className="shrink-0"
      >
        {mode === "request" ? t("requestFollowCta") : t("followEachOtherCta")}
      </Button>
    </div>
  );
}

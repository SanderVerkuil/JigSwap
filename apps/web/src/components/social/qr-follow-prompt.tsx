import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

type QrFollowResult = FunctionReturnType<typeof gateway.social.acceptQrFollow>;

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
// token (the meetup QR-scan case). On a public profile one tap makes them follow each other. On a
// private (`locked`) profile the same tap only sends a follow request, so the copy says so; the
// server applies that rule itself (social/acceptQrFollow) and the toast reports what it did.
export function QrFollowPrompt({
  token,
  name,
  locked,
}: {
  token: string;
  name: string;
  locked: boolean;
}) {
  const t = useTranslations("invite");
  const { mutate, isPending } = useMutation({
    mutationFn: useConvexMutation(gateway.social.acceptQrFollow),
    onSuccess: (result: QrFollowResult) => {
      const key = qrFollowToastKey(result);
      if (key) toast.success(t(key, { name }));
    },
  });
  return (
    <div className="border-jigsaw-primary/20 bg-jigsaw-primary/5 mb-6 flex w-full flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground text-sm">
        {locked
          ? t("requestFollowPrompt", { name })
          : t("followEachOther", { name })}
      </p>
      <Button
        size="sm"
        disabled={isPending}
        onClick={() => mutate({ token })}
        className="shrink-0"
      >
        {locked ? t("requestFollowCta") : t("followEachOtherCta")}
      </Button>
    </div>
  );
}

"use client";

// The sender's outbox at the end of a thread (spec 2.2, 3): photos they sent
// that are not messages yet. "Checking photo…" while the automated check
// runs; once stopped, the in-app statement of reasons ("…our automated check
// flagged it.") with "Ask for a review", then its progress. Shown exactly as
// listMyPendingAttachments reports it: the backend makes every stopped photo
// look alike. Staged-but-unsent photos belong to the composer, not here.
import { blurhashToDataUrl } from "@/components/photos/pending-photo-placeholder";
import { Button } from "@/components/ui/button";
import { gateway, type Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { Clock, ImageOff } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { conversationErrorCode } from "./format";
import { photoAspect } from "./photo-staging";

type PendingPhoto = FunctionReturnType<
  typeof gateway.conversation.listMyPendingAttachments
>[number];

export function PhotoOutbox({
  pending,
  onMediaLoad,
}: {
  pending: readonly PendingPhoto[];
  onMediaLoad?: () => void;
}) {
  // Photos the backend no longer knows for us (AttachmentNotFound on a
  // review request) leave the outbox right away.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const sent = pending.filter(
    (photo) => photo.sendRequested && !gone.has(photo.attachmentId),
  );
  if (sent.length === 0) return null;
  return (
    <li className="flex flex-col items-end gap-1" data-testid="photo-outbox">
      {sent.map((photo) =>
        photo.status === "pending" ? (
          <CheckingPhoto
            key={photo.attachmentId}
            photo={photo}
            onLoad={onMediaLoad}
          />
        ) : (
          <StoppedPhoto
            key={photo.attachmentId}
            photo={photo}
            onGone={() =>
              setGone((current) => new Set(current).add(photo.attachmentId))
            }
          />
        ),
      )}
    </li>
  );
}

function CheckingPhoto({
  photo,
  onLoad,
}: {
  photo: PendingPhoto;
  onLoad?: () => void;
}) {
  const t = useTranslations("messages.photos");
  const blurSrc = useMemo(
    () => blurhashToDataUrl(photo.blurhash ?? null),
    [photo.blurhash],
  );
  return (
    <div
      style={{ aspectRatio: photoAspect(photo.w, photo.h) }}
      className="bg-muted relative w-72 max-w-[80%] overflow-hidden rounded-2xl"
    >
      {(photo.thumbUrl ?? blurSrc) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo.thumbUrl ?? blurSrc ?? undefined}
          alt=""
          onLoad={onLoad}
          className="absolute inset-0 size-full object-cover opacity-80"
        />
      )}
      <span
        role="status"
        className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs font-semibold text-white"
      >
        <Clock className="size-3.5" aria-hidden />
        {t("checking")}
      </span>
    </div>
  );
}

function StoppedPhoto({
  photo,
  onGone,
}: {
  photo: PendingPhoto;
  onGone: () => void;
}) {
  const t = useTranslations("messages.photos");
  const request = useMutation({
    mutationFn: useConvexMutation(gateway.conversation.requestImageReview),
  });
  const ask = async () => {
    try {
      await request.mutateAsync({
        attachmentId: photo.attachmentId as Id<"messageAttachments">,
      });
    } catch (error) {
      if (conversationErrorCode(error) === "AttachmentNotFound") onGone();
      else toast.error(t("reviewFailed"));
    }
  };
  const flagged = photo.reason !== "unreadable";
  return (
    <div
      role="group"
      aria-label={t("notSentLabel")}
      className="text-muted-foreground flex w-72 max-w-[80%] flex-col gap-2 rounded-2xl border-2 border-dashed p-3 text-sm"
    >
      <p className="flex items-start gap-2">
        <ImageOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="text-foreground">
          {flagged ? t("rejected") : t("unreadable")}
        </span>
      </p>
      {flagged &&
        (photo.review === undefined ? (
          <Button
            variant="outline"
            size="sm"
            disabled={request.isPending}
            onClick={() => void ask()}
            className="h-11 self-start md:h-8"
          >
            {t("askReview")}
          </Button>
        ) : (
          <p
            role="status"
            className={cn(
              "text-xs font-medium",
              photo.review === "upheld" && "text-foreground",
            )}
          >
            {photo.review === "requested"
              ? t("reviewRequested")
              : t("reviewUpheld")}
          </p>
        ))}
    </div>
  );
}

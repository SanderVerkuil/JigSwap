"use client";

// A thread's photo media (spec 3): one photo, or a gallery of photos one
// author sent within a minute (a 2x2 grid; with 3 photos the first spans the
// top row). Media sits beside the caption bubble, never inside it. Each box
// reserves its aspect ratio from the stored size so the thread doesn't jump.
//
// Per photo, as this reader may see it:
// - ready: a button that opens the lightbox;
// - blurred (sensitive, not checked, a non-mutual sender, or reported): the
//   blurhash only, with "… · Show" (revealMessageImage, then the photo) and
//   Report; nothing in it describes the content;
// - removed: a "Photo removed" placeholder of the same geometry.
import { blurhashToDataUrl } from "@/components/photos/pending-photo-placeholder";
import { ReportDialog } from "@/components/safety/report-dialog";
import { Button } from "@/components/ui/button";
import { gateway, type Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { EyeOff, Flag, ImageOff } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { conversationErrorCode } from "./format";
import {
  MessagePhotoLightbox,
  type LightboxPhoto,
} from "./message-photo-lightbox";
import { photoAspect } from "./photo-staging";

type ThreadMessage = FunctionReturnType<
  typeof gateway.conversation.listThreadMessages
>["page"][number];
type AttachmentView = NonNullable<ThreadMessage["attachment"]>;

// The single photo / gallery width, as a share of the thread column.
const MEDIA_WIDTH = "w-72 max-w-full";

export type PhotoMessage = Pick<
  ThreadMessage,
  "id" | "kind" | "body" | "attachmentId" | "attachment" | "removed"
>;

// What a photo message renders as for this reader, with a revealed URL
// applied. A photo message without an attachment (removed, or a legacy row)
// is a removed placeholder.
function effectiveView(
  message: PhotoMessage,
  revealed: Record<string, string>,
): AttachmentView {
  const view = message.attachment;
  if (!view || message.removed) return { status: "removed" };
  const url = message.attachmentId && revealed[message.attachmentId];
  if (view.status === "blurred" && url) {
    return { ...view, status: "ready", url, revealed: true };
  }
  return view;
}

export function MessagePhotos({
  messages,
  own,
  authorName,
  authorId,
  onMediaLoad,
}: {
  messages: readonly PhotoMessage[];
  own: boolean;
  /** The sender's display name ("Photo from {name}"). */
  authorName: string;
  authorId?: Id<"users">;
  /** An image finished loading (the thread re-pins to the bottom). */
  onMediaLoad?: () => void;
}) {
  const t = useTranslations("messages.photos");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const reportReturnRef = useRef<HTMLButtonElement | null>(null);
  // The tile that opened the viewer gets focus back when it closes.
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const reveal = useMutation({
    mutationFn: useConvexMutation(gateway.conversation.revealMessageImage),
  });

  const views = messages.map((message) => effectiveView(message, revealed));
  const alt = (message: PhotoMessage) => {
    const caption = message.body.trim();
    const base = own ? t("altOwn") : t("alt", { name: authorName });
    return caption ? `${base}: ${caption}` : base;
  };
  // The lightbox pages through this segment's viewable photos.
  const viewable: LightboxPhoto[] = messages.flatMap((message, index) => {
    const view = views[index];
    return view.status === "ready" && view.url && message.attachmentId
      ? [
          {
            attachmentId: message.attachmentId,
            url: view.url,
            alt: alt(message),
          },
        ]
      : [];
  });

  const showPhoto = async (attachmentId: string) => {
    try {
      const { url } = await reveal.mutateAsync({
        attachmentId: attachmentId as Id<"messageAttachments">,
      });
      setRevealed((current) => ({ ...current, [attachmentId]: url }));
    } catch (error) {
      // AttachmentNotFound (e.g. the reader has an open report on it, or it
      // is gone): it simply stays blurred.
      if (conversationErrorCode(error) !== "AttachmentNotFound") {
        toast.error(t("revealFailed"));
      }
    }
  };

  const count = messages.length;
  const grid = count > 1;
  return (
    <>
      <div
        className={cn(
          MEDIA_WIDTH,
          "overflow-hidden rounded-2xl",
          grid && "grid grid-cols-2 gap-0.5",
        )}
      >
        {messages.map((message, index) => {
          const view = views[index];
          const spans = count === 3 && index === 0;
          const aspect = grid ? (spans ? 2 : 1) : photoAspect(view.w, view.h);
          return (
            <PhotoTile
              key={message.id}
              view={view}
              aspect={aspect}
              className={cn(spans && "col-span-2")}
              compact={grid}
              label={
                grid
                  ? t("tileLabel", { index: index + 1, count })
                  : alt(message)
              }
              onOpen={(trigger) => {
                openerRef.current = trigger;
                const at = viewable.findIndex(
                  (photo) => photo.attachmentId === message.attachmentId,
                );
                if (at >= 0) setLightbox(at);
              }}
              onShow={
                message.attachmentId
                  ? () => void showPhoto(message.attachmentId!)
                  : undefined
              }
              showing={
                reveal.isPending &&
                reveal.variables?.attachmentId === message.attachmentId
              }
              onReport={
                !own && message.attachmentId
                  ? (trigger) => {
                      reportReturnRef.current = trigger;
                      setReporting(message.attachmentId!);
                    }
                  : undefined
              }
              onLoad={onMediaLoad}
            />
          );
        })}
      </div>
      <MessagePhotoLightbox
        photos={viewable}
        index={lightbox ?? 0}
        onIndexChange={setLightbox}
        open={lightbox !== null && viewable.length > 0}
        onOpenChange={(open) => !open && setLightbox(null)}
        returnFocusRef={openerRef}
        authorName={authorName}
        authorId={authorId}
        own={own}
      />
      {reporting && (
        <ReportDialog
          target={{ kind: "attachment", id: reporting }}
          name={authorName}
          memberId={authorId}
          open
          onOpenChange={(open) => !open && setReporting(null)}
          returnFocusRef={reportReturnRef}
        />
      )}
    </>
  );
}

function PhotoTile({
  view,
  aspect,
  className,
  compact,
  label,
  onOpen,
  onShow,
  showing,
  onReport,
  onLoad,
}: {
  view: AttachmentView;
  aspect: number;
  className?: string;
  /** A gallery cell: smaller controls. */
  compact: boolean;
  /** Accessible name of the open button. */
  label: string;
  onOpen: (trigger: HTMLButtonElement) => void;
  onShow?: () => void;
  showing: boolean;
  onReport?: (trigger: HTMLButtonElement) => void;
  onLoad?: () => void;
}) {
  const t = useTranslations("messages.photos");
  const tSafety = useTranslations("safety");
  const blurSrc = useMemo(
    () => blurhashToDataUrl(view.blurhash ?? null),
    [view.blurhash],
  );
  const style = { aspectRatio: aspect };

  if (view.status === "removed") {
    return (
      <div
        style={style}
        className={cn(
          "text-muted-foreground bg-muted/40 flex flex-col items-center justify-center gap-1 rounded-[inherit] border border-dashed p-2 text-center text-xs italic",
          className,
        )}
      >
        <ImageOff className="size-5" aria-hidden />
        {t("removed")}
      </div>
    );
  }

  if (view.status === "blurred" || !view.url) {
    return (
      <div
        style={style}
        className={cn("bg-muted relative overflow-hidden", className)}
      >
        {blurSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={blurSrc}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full object-cover"
          />
        )}
        <div
          className={cn(
            "absolute inset-0 flex flex-col items-center gap-1 bg-black/25 p-1",
            // In a gallery cell, clear of the corner Report button.
            compact ? "justify-end pb-2" : "justify-center",
          )}
        >
          {/* A gallery cell is too narrow for "… · Show" on one pill: the
              label sits above a short Show button (same accessible name). */}
          {compact && (
            <span
              aria-hidden
              className="line-clamp-2 px-1 text-center text-[11px] font-semibold text-white drop-shadow"
            >
              {view.notChecked ? t("notChecked") : t("sensitive")}
            </span>
          )}
          {onShow && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={showing}
              onClick={onShow}
              aria-label={`${view.notChecked ? t("notChecked") : t("sensitive")} · ${t("show")}`}
              className={cn(
                "h-11 max-w-full rounded-full md:h-8",
                compact && "px-2 text-xs",
              )}
            >
              <EyeOff className="size-4" aria-hidden />
              <span className="truncate">
                {!compact &&
                  `${view.notChecked ? t("notChecked") : t("sensitive")} · `}
                {t("show")}
              </span>
            </Button>
          )}
        </div>
        {onReport && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={tSafety("reportPhoto")}
            onClick={(event) => onReport(event.currentTarget)}
            className="absolute top-1 right-1 size-11 rounded-full bg-black/45 text-white hover:bg-black/65 hover:text-white md:size-8"
          >
            <Flag className="size-4" aria-hidden />
          </Button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label={label}
      style={style}
      className={cn(
        "bg-muted focus-visible:ring-ring relative block w-full overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset",
        className,
      )}
    >
      {blurSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={blurSrc}
          alt=""
          aria-hidden
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={(compact && view.thumbUrl) || view.url}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={onLoad}
        className="absolute inset-0 size-full object-cover"
      />
    </button>
  );
}

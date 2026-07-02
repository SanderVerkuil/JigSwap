"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { gateway, Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  MessageCircle,
  Star,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

// The web tier derives Convex view types from the gateway (not @jigswap/contracts directly).
type CopyInstanceView = NonNullable<
  FunctionReturnType<typeof gateway.library.getCopyInstanceView>
>;
type GalleryPhoto = CopyInstanceView["gallery"][number];
type PhotoComment = FunctionReturnType<
  typeof gateway.library.listPhotoComments
>[number];

// A modal gallery viewer: shows the active photo near-full-size (object-contain on a dark
// backdrop), prev/next navigation across the copy's photos, the photo's metadata, and a
// per-photo discussion (composer + list). The comments query keys on the ACTIVE photo's id, so
// it refetches automatically as you navigate between photos.
export function PhotoLightbox({
  gallery,
  index,
  open,
  onOpenChange,
  onIndexChange,
  canSetCover,
  copyId,
  coverImageId,
}: {
  gallery: GalleryPhoto[];
  index: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIndexChange: (index: number) => void;
  /** Owner-only: lets the viewer set this photo as the copy's cover. */
  canSetCover: boolean;
  /** The copy's `ownedPuzzles` _id (setCopyCover keys on this). */
  copyId: string;
  /** The currently-selected cover photo id, or null when the catalogue image is in use. */
  coverImageId: string | null;
}) {
  const t = useTranslations("copyInstance.photoLightbox");
  const format = useFormatter();
  const setCopyCover = useMutation({
    mutationFn: useConvexMutation(gateway.library.setCopyCover),
  });
  const removeCopyPhoto = useMutation({
    mutationFn: useConvexMutation(gateway.library.removeCopyPhoto),
  });
  const settingCover = setCopyCover.isPending;
  const removing = removeCopyPhoto.isPending;
  const [confirmRemove, setConfirmRemove] = useState(false);

  const count = gallery.length;
  const photo = gallery[index];

  // Reset the remove-confirmation when the shown photo changes, so a primed confirm never carries
  // over to a different photo after navigating.
  useEffect(() => {
    setConfirmRemove(false);
  }, [index]);

  const setAsCover = async () => {
    if (!photo) return;
    try {
      await setCopyCover.mutateAsync({
        copyId: copyId as Id<"ownedPuzzles">,
        coverImageId: photo.id as Id<"ownedPuzzleImages">,
      });
      toast.success(t("coverUpdated"));
    } catch {
      toast.error(t("coverFailed"));
    }
  };

  // Clear the cover (omit coverImageId) so the copy falls back to the catalogue image.
  const unsetCover = async () => {
    try {
      await setCopyCover.mutateAsync({ copyId: copyId as Id<"ownedPuzzles"> });
      toast.success(t("coverUpdated"));
    } catch {
      toast.error(t("coverFailed"));
    }
  };

  const removePhoto = async () => {
    if (!photo) return;
    try {
      await removeCopyPhoto.mutateAsync({
        imageId: photo.id as Id<"ownedPuzzleImages">,
      });
      toast.success(t("photoRemoved"));
      onOpenChange(false); // close; the gallery refetches via Convex reactivity
    } catch {
      toast.error(t("removeFailed"));
    } finally {
      setConfirmRemove(false);
    }
  };

  // Arrow-key navigation while the lightbox is open. Wraps at both ends so the gallery is a loop.
  // Esc/overlay close stays with the Dialog's built-in behaviour.
  const go = (delta: number) => {
    if (count === 0) return;
    onIndexChange((index + delta + count) % count);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `index`/`count` are read inside `go`; re-bind when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, count]);

  if (!photo) return null;

  const takenAt = photo.takenAt ?? photo.createdAt;
  const takenLabel = format.dateTime(new Date(takenAt), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Override the dialog's default `sm:max-w-lg` (else the lightbox stays ~512px wide) so it
        // fills most of the viewport; the image stage takes the lion's share, comments sit beside it.
        className="grid h-[90vh] max-h-[90vh] w-full max-w-[96vw] grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[96vw] md:max-h-[88vh] md:max-w-[min(94vw,1500px)] md:grid-cols-[minmax(0,2.2fr)_minmax(340px,1fr)] md:grid-rows-1"
        showCloseButton={true}
      >
        {/* a11y: titled but visually hidden so the dialog announces itself to screen readers. */}
        <DialogTitle className="sr-only">
          {photo.caption ?? t("comments")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("counter", { current: index + 1, total: count })}
        </DialogDescription>

        {/* Image stage */}
        <div className="relative flex min-h-0 items-center justify-center bg-neutral-950">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.url}
            alt={photo.caption ?? ""}
            className="max-h-full max-w-full object-contain"
          />

          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label={t("prev")}
                className="absolute top-1/2 left-3 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70 focus:ring-2 focus:ring-white/70 focus:outline-none"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label={t("next")}
                className="absolute top-1/2 right-3 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70 focus:ring-2 focus:ring-white/70 focus:outline-none"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-1 font-mono text-xs font-semibold text-white">
                {t("counter", { current: index + 1, total: count })}
              </span>
            </>
          )}
        </div>

        {/* Metadata + comments column */}
        <div className="border-border flex min-h-0 flex-col overflow-y-auto border-t md:border-t-0 md:border-l">
          <div className="space-y-3 p-5 pt-6">
            {photo.caption && (
              <h2 className="font-heading text-foreground text-lg font-bold">
                {photo.caption}
              </h2>
            )}
            {photo.tag && (
              <Badge variant="secondary" className="rounded-full text-xs">
                {photo.tag}
              </Badge>
            )}
            {photo.description && (
              <p className="text-foreground/90 text-sm leading-relaxed">
                {photo.description}
              </p>
            )}
            <dl className="text-sm">
              <div className="text-muted-foreground">
                {t("uploadedBy", { name: photo.uploaderName ?? "—" })}
              </div>
              <div className="text-muted-foreground">
                {t("takenOn", { date: takenLabel })}
              </div>
            </dl>

            {photo.moderationStatus === "pending" && (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                <Clock className="h-3.5 w-3.5" />
                {t("pendingReview")}
              </div>
            )}

            {/* Owner-only: choose this photo as the copy's cover, right where you're viewing it. */}
            {canSetCover &&
              (coverImageId === photo.id ? (
                // Already the cover — clicking clears it back to the catalogue image.
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void unsetCover()}
                  disabled={settingCover}
                  className="w-full"
                >
                  <Star className="h-4 w-4" fill="currentColor" />
                  {t("unsetCover")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void setAsCover()}
                  disabled={settingCover}
                  className="w-full"
                >
                  <Star className="h-4 w-4" />
                  {t("setAsCover")}
                </Button>
              ))}

            {/* Owner-only: remove this photo. Two-step inline confirm; on success the lightbox
                closes and the gallery refetches. */}
            {canSetCover &&
              (confirmRemove ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void removePhoto()}
                    disabled={removing}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("confirmRemove")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmRemove(false)}
                    disabled={removing}
                  >
                    {t("cancel")}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmRemove(true)}
                  className="text-destructive hover:text-destructive w-full justify-start"
                >
                  <Trash2 className="h-4 w-4" />
                  {t("removePhoto")}
                </Button>
              ))}
          </div>

          <div className="border-border border-t px-5 py-4">
            <PhotoComments photoId={photo.id as Id<"ownedPuzzleImages">} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PhotoComments({ photoId }: { photoId: Id<"ownedPuzzleImages"> }) {
  const t = useTranslations("copyInstance.photoLightbox");
  const format = useFormatter();

  // Keyed on the ACTIVE photo's id: navigating in the lightbox swaps `photoId`, which re-runs
  // this Convex query and re-renders the list for the newly shown photo.
  const { data: comments } = useQuery(
    convexQuery(gateway.library.listPhotoComments, { photoId }),
  );
  const { data: me } = useQuery(convexQuery(gateway.identity.currentUser, {}));
  const postComment = useMutation({
    mutationFn: useConvexMutation(gateway.library.postPhotoComment),
  });

  const [text, setText] = useState("");
  const posting = postComment.isPending;
  const [now] = useState(() => Date.now());

  const list = comments ?? [];
  const relative = (timestamp: number) =>
    format.relativeTime(new Date(timestamp), now);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      await postComment.mutateAsync({ photoId, text: trimmed });
      setText("");
    } catch {
      toast.error(t("commentFailed"));
    }
  };

  return (
    <section>
      <div className="text-muted-foreground mb-3 flex items-center gap-2 text-sm font-semibold">
        <MessageCircle className="h-4 w-4" />
        {t("comments")}
        <span className="font-mono text-xs">{list.length}</span>
      </div>

      {/* Composer */}
      <div className="mb-3 flex gap-2.5">
        <Avatar className="h-8 w-8">
          {me?.avatar && <AvatarImage src={me.avatar} alt={me.name} />}
          <AvatarFallback className="text-xs font-medium">
            {(me?.name ?? "?").slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <Input
          placeholder={t("addComment")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          className="flex-1"
        />
        <Button
          variant="brand"
          onClick={() => void submit()}
          disabled={posting || text.trim().length === 0}
        >
          {t("post")}
        </Button>
      </div>

      {/* List */}
      <div className="flex flex-col">
        {list.map((comment, i) => (
          <PhotoCommentRow
            key={comment.id}
            comment={comment}
            relative={relative}
            last={i === list.length - 1}
          />
        ))}
        {list.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("noComments")}</p>
        )}
      </div>
    </section>
  );
}

function PhotoCommentRow({
  comment,
  relative,
  last,
}: {
  comment: PhotoComment;
  relative: (timestamp: number) => string;
  last: boolean;
}) {
  const name = comment.author.name;
  return (
    <div className={cn("flex gap-3 py-3", !last && "border-border border-b")}>
      <Avatar className="h-8 w-8">
        {comment.author.avatar && (
          <AvatarImage src={comment.author.avatar} alt={name} />
        )}
        <AvatarFallback className="text-xs font-medium">
          {name.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground text-sm font-semibold">{name}</span>
          <span className="text-muted-foreground text-xs">
            {relative(comment.createdAt)}
          </span>
        </div>
        <p className="text-foreground/90 mt-1 text-sm leading-relaxed">
          {comment.text}
        </p>
      </div>
    </div>
  );
}

"use client";

// "Photos of puzzles you no longer have" under Privacy & safety: the caller's own photos on copies
// they no longer manage (library.listMyPhotosOnFormerCopies), each with Remove behind a confirm. A
// seller can't open the copy's page any more, so this is how they take a photo of their home down
// (SEC-38). The read carries nothing about the copy, so a row shows only what the member added.
//
// Hidden when there is nothing to act on. The read filters after it pages, so a page can come back
// short or empty with more to read: it keeps reading until a screenful is on it. usePaginatedQuery
// throws when a page fails, and the backend may lag this build, so a failure takes only this section
// away, never the rest of the panel.
//
// The confirm is inline, as in the photo lightbox: this section lives in Clerk's profile modal, which
// stacks above the app's dialogs (z-index 10000 against z-50), so an AlertDialog would open out of
// sight behind it.
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { gateway, type Id } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ImageOff } from "lucide-react";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

type FormerCopyPhoto = FunctionReturnType<
  typeof gateway.library.myPhotosOnFormerCopies
>["page"][number];

// Uploads read per page, and how many rows make a screenful worth stopping at.
const PAGE_SIZE = 25;
const SCREENFUL = 10;

export function MyFormerCopyPhotos() {
  return (
    <ErrorBoundary fallback={NoSection}>
      <Section />
    </ErrorBoundary>
  );
}

const NoSection = () => null;

function Section() {
  const t = useTranslations("safety.formerCopyPhotos");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { results, status, loadMore } = usePaginatedQuery(
    gateway.library.myPhotosOnFormerCopies,
    {},
    { initialNumItems: PAGE_SIZE },
  );

  const shown = results.length;
  useEffect(() => {
    if (status === "CanLoadMore" && shown < SCREENFUL) loadMore(PAGE_SIZE);
  }, [status, shown, loadMore]);

  if (shown === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-sm font-medium outline-none"
      >
        {t("title")}
      </h2>
      <p className="text-muted-foreground text-sm">{t("description")}</p>
      <ul className="divide-y">
        {results.map((photo) => (
          <PhotoRow
            key={photo.imageId}
            photo={photo}
            afterRemoval={headingRef}
          />
        ))}
      </ul>
      {status === "CanLoadMore" && (
        <Button
          variant="outline"
          size="sm"
          className="h-11 self-start md:h-8"
          onClick={() => loadMore(PAGE_SIZE)}
        >
          {t("showMore")}
        </Button>
      )}
    </section>
  );
}

function PhotoRow({
  photo,
  afterRemoval,
}: {
  photo: FormerCopyPhoto;
  /** Takes focus once this row is gone. */
  afterRemoval: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("safety.formerCopyPhotos");
  const tPhoto = useTranslations("copyInstance.photoLightbox");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const removePhoto = useConvexMutation(gateway.library.removeCopyPhoto);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const removeRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmId = useId();

  const name = photo.title ?? t("photo");
  const date = format.dateTime(new Date(photo.createdAt), {
    dateStyle: "medium",
  });

  const confirm = async () => {
    setRemoving(true);
    try {
      await removePhoto({ imageId: photo.imageId as Id<"ownedPuzzleImages"> });
      toast.success(tPhoto("photoRemoved"));
      afterRemoval.current?.focus();
    } catch {
      toast.error(tPhoto("removeFailed"));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <div className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md">
        {photo.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.url}
            alt={name}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <ImageOff className="size-4" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-muted-foreground text-xs">{t("added", { date })}</p>
      </div>
      {confirming ? (
        <div
          role="group"
          aria-labelledby={confirmId}
          className="flex basis-full flex-col gap-2"
        >
          <p id={confirmId} className="text-sm">
            {t("confirmBody")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              size="sm"
              className="h-11 md:h-8"
              disabled={removing}
              onClick={() => void confirm()}
            >
              {tPhoto("removePhoto")}
            </Button>
            <Button
              ref={cancelRef}
              variant="outline"
              size="sm"
              className="h-11 md:h-8"
              disabled={removing}
              onClick={() => {
                flushSync(() => setConfirming(false));
                removeRef.current?.focus();
              }}
            >
              {tCommon("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          ref={removeRef}
          variant="outline"
          size="sm"
          className="h-11 shrink-0 md:h-8"
          aria-label={t("removeName", { name, date })}
          onClick={() => {
            flushSync(() => setConfirming(true));
            cancelRef.current?.focus();
          }}
        >
          {t("remove")}
        </Button>
      )}
    </li>
  );
}

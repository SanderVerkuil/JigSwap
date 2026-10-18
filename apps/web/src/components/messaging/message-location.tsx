"use client";

// A location message's media (spec 3): the static map preview rendered once
// at send time and served from our own storage (no map provider sees the
// reader), then the place's label in bold, "Approximate area" for an
// approximate location, and an "Open in maps" link (openstreetmap.org, a new
// tab, loaded only when tapped). A failed render is a text card with the
// coordinates and the same link. Sits beside the caption bubble, like photos.
import type { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";
import { ExternalLink, MapPin } from "lucide-react";
import { useTranslations } from "use-intl";

type ThreadMessage = FunctionReturnType<
  typeof gateway.conversation.listThreadMessages
>["page"][number];
export type LocationView = Extract<
  NonNullable<ThreadMessage["attachment"]>,
  { kind: "location" }
>;

/** A message's attachment when it is a shared location. */
export function locationAttachmentOf(
  attachment: ThreadMessage["attachment"],
): LocationView | undefined {
  return attachment && "kind" in attachment && attachment.kind === "location"
    ? attachment
    : undefined;
}

const MEDIA_WIDTH = "w-72 max-w-full";

export function MessageLocation({
  location,
  className,
  onMediaLoad,
}: {
  /** Absent when the location is gone (removed or deleted). */
  location: LocationView | undefined;
  className?: string;
  /** The map finished loading (the thread re-pins to the bottom). */
  onMediaLoad?: () => void;
}) {
  const t = useTranslations("messages.locations");
  if (!location) {
    return (
      <div
        className={cn(
          MEDIA_WIDTH,
          "text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm",
          className,
        )}
      >
        <MapPin className="size-4 shrink-0" aria-hidden />
        {t("locationGone")}
      </div>
    );
  }
  const place = location.label ?? t("sharedLocation");
  const approximate = location.precision === "approximate";
  return (
    <figure
      className={cn(
        MEDIA_WIDTH,
        "bg-card overflow-hidden rounded-lg border",
        className,
      )}
    >
      {location.mapUrl ? (
        // 600x300 preview: reserve 2:1 so the thread doesn't jump. Served
        // from our own storage, so no image optimizer in between.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={location.mapUrl}
          alt={t("mapPreviewAlt", { place })}
          width={600}
          height={300}
          className="bg-muted aspect-[2/1] w-full object-cover"
          onLoad={onMediaLoad}
        />
      ) : (
        <div className="bg-muted text-muted-foreground flex items-center gap-2 px-3 py-2 text-xs">
          <MapPin className="size-4 shrink-0" aria-hidden />
          <span>
            {t("mapUnavailable")}
            {" · "}
            <span className="tabular-nums">
              {location.lat}, {location.lng}
            </span>
          </span>
        </div>
      )}
      <figcaption className="flex flex-col gap-0.5 px-3 py-2 text-sm">
        <span className="font-semibold break-words">{place}</span>
        {approximate && (
          <span className="text-muted-foreground text-xs">
            {t("approximateArea")}
          </span>
        )}
        <a
          href={location.openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-text inline-flex min-h-11 items-center gap-1 self-start font-medium underline-offset-2 hover:underline md:min-h-0"
        >
          {t("openInMaps")}
          <ExternalLink className="size-3.5" aria-hidden />
          <span className="sr-only">{t("opensInNewTab")}</span>
        </a>
      </figcaption>
    </figure>
  );
}

"use client";

// "Share a location" (spec 2.4, 3, R.5, R.6): a dialog from md up, a bottom
// sheet on phones. Search-first and without any client-side map key: place
// search (searchPlaces) and every map view (renderPickerMap) go through our
// server, which talks to MapTiler, so this browser never contacts a map
// provider. The pin is always the centre of the server-rendered view:
// - a search result, a tap on the map, or an arrow button moves it there
//   (a placed pin: shared exactly);
// - "Use my current location" (behind the browser's permission prompt) only
//   centres the view on the device's position; until the pin is moved, it is
//   the member's current location, shared approximately unless they turn on
//   "exact", which is offered only when the recipient is a mutual follower;
// - +/− zoom. Every control is a button (keyboard operable, never drag-only).
// A tap converts to coordinates with Web Mercator math for the rendered view
// (location-math). Sending calls sendLocation; the server re-applies the
// precision rule and renders the final preview.
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useConvexAction, useConvexMutation } from "@convex-dev/react-query";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  LocateFixed,
  MapPin,
  Minus,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { conversationErrorCode } from "./format";
import {
  clampZoom,
  coarsen,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  round5,
  tapToLatLng,
} from "./location-math";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
// Picker images live ~10 minutes on the server; reuse a view for less.
const VIEW_CACHE_MS = 5 * 60_000;
// The arrow buttons pan by this share of the view.
const PAN_SHARE = 0.25;
const SEARCH_ZOOM = 16;
const GPS_ZOOM = 15;
const MAX_LABEL_LENGTH = 80;
const MAX_CAPTION_LENGTH = 1000;

type Pin = {
  lat: number;
  lng: number;
  zoom: number;
  /** "gps": the device position, not moved since. */
  source: "pin" | "gps";
};

export type LocationPickerProps = {
  threadId: string;
  /** The recipient's display name (consent copy, exact warning). */
  recipientName: string;
  /** The recipient is a mutual follower: "exact" may be offered for GPS. */
  exactCurrentLocation: boolean;
  /** The location was sent. */
  onSent: () => void;
  /** The thread no longer accepts replies (never names a block). */
  onCannotReply: () => void;
  /** Location sharing turned out to be unavailable: hide it. */
  onUnavailable: () => void;
};

export function LocationPicker({
  open,
  onOpenChange,
  onCloseAutoFocus,
  ...props
}: LocationPickerProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const t = useTranslations("messages.locations");
  const tCommon = useTranslations("common");
  const isMobile = useIsMobile();
  const consent = t("consent", { name: props.recipientName });
  const body = (
    <LocationPickerBody
      {...props}
      onSent={() => {
        props.onSent();
        onOpenChange(false);
      }}
    />
  );
  const closeButton = (
    <Button
      variant="ghost"
      size="icon"
      className="size-11 shrink-0"
      aria-label={tCommon("close")}
    >
      <X className="size-5" />
    </Button>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          // Never pop the keyboard unasked on phones.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          onCloseAutoFocus={onCloseAutoFocus}
          className="bg-card h-[92dvh] gap-0 rounded-t-[20px] border-t-0 p-0 motion-reduce:animate-none [&>button]:hidden"
        >
          <div className="flex items-center gap-2 py-1.5 pr-1.5 pl-4">
            <SheetTitle className="font-heading min-w-0 flex-1 text-lg font-bold">
              {t("pickerTitle")}
            </SheetTitle>
            <SheetClose asChild>{closeButton}</SheetClose>
          </div>
          <SheetDescription className="text-muted-foreground px-4 pb-2 text-sm">
            {consent}
          </SheetDescription>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={onCloseAutoFocus}
        className="flex max-h-[90vh] max-w-xl flex-col gap-0 p-0 motion-reduce:animate-none"
      >
        <div className="flex items-center gap-2 py-2 pr-2 pl-5">
          <DialogTitle className="font-heading min-w-0 flex-1 text-lg font-bold">
            {t("pickerTitle")}
          </DialogTitle>
          <DialogClose asChild>{closeButton}</DialogClose>
        </div>
        <DialogDescription className="text-muted-foreground px-5 pb-2 text-sm">
          {consent}
        </DialogDescription>
        {body}
      </DialogContent>
    </Dialog>
  );
}

/** The picker's content (exported for tests and the dev story). */
export function LocationPickerBody({
  threadId,
  recipientName,
  exactCurrentLocation,
  onSent,
  onCannotReply,
  onUnavailable,
}: LocationPickerProps) {
  const t = useTranslations("messages.locations");
  const ids = {
    search: useId(),
    label: useId(),
    caption: useId(),
    exact: useId(),
    hint: useId(),
  };
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const [pin, setPin] = useState<Pin | null>(null);
  const [nearHint, setNearHint] = useState<{ lat: number; lng: number }>();
  const [gps, setGps] = useState<"idle" | "locating" | "denied">("idle");
  const [exact, setExact] = useState(false);
  const [label, setLabel] = useState("");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);

  const searchPlaces = useConvexAction(gateway.conversation.searchPlaces);
  const renderPickerMap = useConvexAction(gateway.conversation.renderPickerMap);
  const sendLocation = useMutation({
    mutationFn: useConvexMutation(gateway.conversation.sendLocation),
  });

  const results = useQuery({
    queryKey: ["location-search", threadId, search, nearHint],
    queryFn: () =>
      searchPlaces({
        threadId,
        query: search,
        ...(nearHint ? { near: nearHint } : {}),
      }),
    enabled: search.length >= MIN_QUERY_LENGTH,
    staleTime: VIEW_CACHE_MS,
    gcTime: VIEW_CACHE_MS,
    retry: false,
  });

  const map = useQuery({
    queryKey: [
      "location-picker-map",
      threadId,
      pin?.lat,
      pin?.lng,
      pin?.zoom,
      pin?.source,
    ],
    queryFn: () =>
      renderPickerMap({
        threadId,
        lat: pin!.lat,
        lng: pin!.lng,
        zoom: pin!.zoom,
        // Lets the server recognise a "pin" left on the device position.
        ...(pin!.source === "gps" ? { mode: "gps" as const } : {}),
      }),
    enabled: pin !== null,
    staleTime: VIEW_CACHE_MS,
    gcTime: VIEW_CACHE_MS,
    retry: false,
    placeholderData: keepPreviousData,
  });
  // The view the shown image was rendered for (a tap maps against it).
  const view = map.data;
  const mapUnavailable =
    map.isError && conversationErrorCode(map.error) === "LocationUnavailable";
  useEffect(() => {
    if (mapUnavailable) onUnavailable();
  }, [mapUnavailable, onUnavailable]);

  const moveTo = (lat: number, lng: number, zoom: number) => {
    setPin({
      lat: round5(lat),
      lng: round5(lng),
      zoom: clampZoom(zoom),
      source: "pin",
    });
    setError(null);
  };

  const locateMe = () => {
    if (!("geolocation" in navigator)) {
      setGps("denied");
      return;
    }
    setGps("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setGps("idle");
        setPin({
          lat: round5(latitude),
          lng: round5(longitude),
          zoom: GPS_ZOOM,
          source: "gps",
        });
        // A search hint only: coarsened before it leaves the device.
        setNearHint({ lat: coarsen(latitude), lng: coarsen(longitude) });
        setError(null);
      },
      () => setGps("denied"),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  const fromGps = pin?.source === "gps";
  const precision: "exact" | "approximate" =
    fromGps && !(exact && exactCurrentLocation) ? "approximate" : "exact";

  const send = async () => {
    if (!pin || sendLocation.isPending) return;
    setError(null);
    try {
      await sendLocation.mutateAsync({
        threadId,
        lat: pin.lat,
        lng: pin.lng,
        source: pin.source,
        precision,
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(caption.trim() ? { caption: caption.trim() } : {}),
      });
      onSent();
    } catch (err) {
      const code = conversationErrorCode(err);
      if (code === "CannotReply" || code === "NotConnected") {
        onCannotReply();
        return;
      }
      if (code === "LocationUnavailable") {
        onUnavailable();
        return;
      }
      setError(code === "RateLimited" ? t("rateLimited") : t("sendFailed"));
    }
  };

  const zoomBy = (delta: number) => {
    if (!pin) return;
    setPin({ ...pin, zoom: clampZoom(pin.zoom + delta) });
  };
  const pan = (dx: number, dy: number) => {
    if (!view) return;
    const centre = panBy(view, dx, dy);
    moveTo(centre.lat, centre.lng, view.zoom);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-5 md:pb-5">
      {/* Search */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.search}>{t("searchLabel")}</Label>
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            id={ids.search}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            autoComplete="off"
            className="min-h-11 pl-9 md:min-h-10"
          />
        </div>
        <SearchResults
          state={
            search.length < MIN_QUERY_LENGTH
              ? "idle"
              : results.isError
                ? "error"
                : results.data
                  ? "done"
                  : "loading"
          }
          results={results.data ?? []}
          onPick={(place) => {
            moveTo(place.lat, place.lng, SEARCH_ZOOM);
            setLabel(
              place.label.split(",")[0].trim().slice(0, MAX_LABEL_LENGTH),
            );
            setQuery("");
            setSearch("");
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="min-h-11 self-start md:min-h-9"
          onClick={locateMe}
          disabled={gps === "locating"}
        >
          <LocateFixed aria-hidden />
          {gps === "locating" ? t("locating") : t("useCurrentLocation")}
        </Button>
        {gps === "denied" && (
          <p role="status" className="text-muted-foreground text-xs">
            {t("locationDenied")}
          </p>
        )}
      </div>

      {/* Map */}
      <div className="flex flex-col gap-2">
        <div
          className="bg-muted relative aspect-[5/3] w-full overflow-hidden rounded-lg border"
          aria-busy={map.isFetching}
        >
          {view ? (
            // A tap moves the pin; keyboard users have the buttons below
            // (a keyboard "click" has no position, so it is ignored).
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              className="block size-full cursor-crosshair"
              onClick={(event) => {
                if (event.detail === 0) return;
                const rect = event.currentTarget.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return;
                const at = tapToLatLng(
                  view,
                  { x: event.clientX - rect.left, y: event.clientY - rect.top },
                  { width: rect.width, height: rect.height },
                );
                moveTo(at.lat, at.lng, view.zoom);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={view.url}
                alt=""
                width={view.width}
                height={view.height}
                className="size-full object-cover"
                draggable={false}
              />
            </button>
          ) : (
            <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
              <MapPin className="size-6" aria-hidden />
              {map.isError ? t("mapFailed") : t("pickFirst")}
            </div>
          )}
          {view && (map.isFetching || map.isError) && (
            <div
              role="status"
              className="bg-background/70 absolute inset-x-0 bottom-0 px-3 py-1.5 text-center text-xs"
            >
              {map.isError ? t("mapFailed") : t("mapLoading")}
            </div>
          )}
          {/* The picture's meaning for screen readers. */}
          {view && <span className="sr-only">{t("mapAlt")}</span>}
        </div>
        <p id={ids.hint} className="text-muted-foreground text-xs">
          {t("mapHint")}
        </p>
        <div
          role="group"
          aria-label={t("mapAlt")}
          aria-describedby={ids.hint}
          className="flex flex-wrap items-center gap-2"
        >
          <MapButton
            label={t("zoomOut")}
            onClick={() => zoomBy(-1)}
            disabled={!pin || pin.zoom <= MIN_ZOOM}
          >
            <Minus />
          </MapButton>
          <MapButton
            label={t("zoomIn")}
            onClick={() => zoomBy(1)}
            disabled={!pin || pin.zoom >= MAX_ZOOM}
          >
            <Plus />
          </MapButton>
          <span className="w-2" aria-hidden />
          <MapButton
            label={t("panLeft")}
            onClick={() => pan(-PAN_SHARE, 0)}
            disabled={!view}
          >
            <ArrowLeft />
          </MapButton>
          <MapButton
            label={t("panUp")}
            onClick={() => pan(0, -PAN_SHARE)}
            disabled={!view}
          >
            <ArrowUp />
          </MapButton>
          <MapButton
            label={t("panDown")}
            onClick={() => pan(0, PAN_SHARE)}
            disabled={!view}
          >
            <ArrowDown />
          </MapButton>
          <MapButton
            label={t("panRight")}
            onClick={() => pan(PAN_SHARE, 0)}
            disabled={!view}
          >
            <ArrowRight />
          </MapButton>
        </div>
      </div>

      {/* Precision: only for the device position */}
      {fromGps &&
        (exactCurrentLocation ? (
          <div className="flex flex-col gap-1">
            <div className="flex min-h-11 items-center gap-3 md:min-h-9">
              <Switch
                id={ids.exact}
                checked={exact}
                onCheckedChange={setExact}
              />
              <Label htmlFor={ids.exact}>{t("exactToggle")}</Label>
            </div>
            <p className="text-muted-foreground text-xs">
              {exact
                ? t("exactWarning", { name: recipientName })
                : t("approximateNote")}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            {t("approximateNote")}
          </p>
        ))}

      {/* Label and caption */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.label}>{t("labelLabel")}</Label>
        <Input
          id={ids.label}
          value={label}
          maxLength={MAX_LABEL_LENGTH}
          onChange={(event) => setLabel(event.target.value)}
          className="min-h-11 md:min-h-10"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.caption}>{t("captionLabel")}</Label>
        <Textarea
          id={ids.caption}
          value={caption}
          rows={2}
          maxLength={MAX_CAPTION_LENGTH}
          onChange={(event) => setCaption(event.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button
        type="button"
        className="min-h-11 md:min-h-10"
        onClick={() => void send()}
        disabled={!pin || sendLocation.isPending}
      >
        <MapPin aria-hidden />
        {sendLocation.isPending ? t("sending") : t("send")}
      </Button>
    </div>
  );
}

function MapButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-11 md:size-9"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

function SearchResults({
  state,
  results,
  onPick,
}: {
  state: "idle" | "loading" | "error" | "done";
  results: readonly { label: string; lat: number; lng: number }[];
  onPick: (place: { label: string; lat: number; lng: number }) => void;
}) {
  const t = useTranslations("messages.locations");
  if (state === "idle") return null;
  if (state !== "done" || results.length === 0) {
    return (
      <p
        role="status"
        className={cn(
          "text-xs",
          state === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {state === "loading"
          ? t("searching")
          : state === "error"
            ? t("searchFailed")
            : t("noResults")}
      </p>
    );
  }
  return (
    <ul
      className="flex flex-col divide-y rounded-md border"
      aria-label={t("searchLabel")}
    >
      {results.map((place) => (
        <li key={`${place.lat},${place.lng},${place.label}`}>
          <button
            type="button"
            onClick={() => onPick(place)}
            className="hover:bg-accent focus-visible:ring-ring flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
          >
            <MapPin
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden
            />
            <span className="min-w-0 break-words">{place.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

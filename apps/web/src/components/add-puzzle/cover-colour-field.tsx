// apps/web/src/components/add-puzzle/cover-colour-field.tsx
import { Check, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { COVER_SWATCHES } from "./add-puzzle-schema";

type Dim = { w: number; h: number };
type DimMap = Record<string, Dim>;

/**
 * A thumbnail image that records its natural resolution once decoded.
 * Handles the cached-image case (where `onLoad` may never fire) by
 * checking `img.complete && img.naturalWidth` on mount.
 */
function MeasuredThumb({
  url,
  onMeasure,
}: {
  url: string;
  onMeasure: (url: string, dim: Dim) => void;
}) {
  const ref = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth > 0) {
      onMeasure(url, { w: img.naturalWidth, h: img.naturalHeight });
    }
    // Only re-check when the url changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return (
    <img
      ref={ref}
      src={url}
      alt=""
      className="size-full object-cover"
      onLoad={(e) => {
        const el = e.currentTarget;
        if (el.naturalWidth > 0) {
          onMeasure(url, { w: el.naturalWidth, h: el.naturalHeight });
        }
      }}
      onError={() => onMeasure(url, { w: 0, h: 0 })}
    />
  );
}

export function CoverColourField({
  color,
  mode,
  photoOptions,
  selectedPhotoUrl,
  onSelectColor,
  onSelectPhoto,
  onUploadPhoto,
}: {
  color: string;
  mode: "color" | "photo";
  photoOptions: ReadonlyArray<{ url: string; uploaded?: boolean }>;
  selectedPhotoUrl?: string;
  onSelectColor: (c: string) => void;
  onSelectPhoto: (url: string) => void;
  onUploadPhoto: (file: File) => void;
}) {
  const t = useTranslations("puzzles");

  // Measured natural resolutions, keyed by url. w/h of 0 means "measured but
  // unusable" (failed to load / not decodable).
  const [dims, setDims] = useState<DimMap>({});

  // One-shot guard: once the user makes a manual pick, never auto-select again
  // (until a new import resets it).
  const userPicked = useRef(false);

  // Keep a stable ref to the (inline) onSelectPhoto closure so the auto-select
  // effect doesn't re-run on every parent render.
  const onSelectPhotoRef = useRef(onSelectPhoto);
  useEffect(() => {
    onSelectPhotoRef.current = onSelectPhoto;
  });

  const recordDim = (url: string, dim: Dim) => {
    setDims((prev) => (url in prev ? prev : { ...prev, [url]: dim }));
  };

  // Reset measurement + user-pick state when the SET of option urls changes
  // (i.e. a new import replaced the candidates).
  const urlSet = useMemo(
    () => photoOptions.map((o) => o.url).join("|"),
    [photoOptions],
  );
  const prevUrlSet = useRef(urlSet);
  if (prevUrlSet.current !== urlSet) {
    prevUrlSet.current = urlSet;
    userPicked.current = false;
    setDims({});
  }

  // Non-uploaded (imported) options are the only ones eligible for comparison.
  const importedUrls = useMemo(
    () => photoOptions.filter((o) => !o.uploaded).map((o) => o.url),
    [photoOptions],
  );

  // "Best" = largest pixel area among imported options. Only computed once
  // every imported option has a usable (w>0) measurement. Suppressed when:
  // there is a single imported option, or the top-two areas are within 10%.
  const best = useMemo<string | undefined>(() => {
    if (importedUrls.length < 2) return undefined;
    const areas: Array<{ url: string; area: number }> = [];
    for (const url of importedUrls) {
      const d = dims[url];
      if (!d || d.w <= 0) return undefined; // not all measured yet
      areas.push({ url, area: d.w * d.h });
    }
    areas.sort((a, b) => b.area - a.area);
    const [top, second] = areas;
    if (second && second.area / top.area > 0.9) return undefined; // too close
    return top.url;
  }, [importedUrls, dims]);

  // Auto-select the best image exactly once, never overriding a manual pick.
  useEffect(() => {
    if (mode !== "photo") return;
    if (userPicked.current) return;
    if (!best) return;
    if (best === selectedPhotoUrl) return;
    onSelectPhotoRef.current(best);
  }, [mode, best, selectedPhotoUrl]);

  // Render order: imported options by measured area desc (unmeasured → 0,
  // sorted after measured ones), then uploaded option(s) last.
  const orderedOptions = useMemo(() => {
    const imported = photoOptions.filter((o) => !o.uploaded);
    const uploaded = photoOptions.filter((o) => o.uploaded);
    const area = (url: string) => {
      const d = dims[url];
      return d && d.w > 0 ? d.w * d.h : 0;
    };
    const sortedImported = [...imported].sort(
      (a, b) => area(b.url) - area(a.url),
    );
    return [...sortedImported, ...uploaded];
  }, [photoOptions, dims]);

  return (
    <div className="flex flex-wrap gap-2.5">
      {/* Photo thumbnails — one per option */}
      {orderedOptions.map((opt) => {
        const selected = mode === "photo" && selectedPhotoUrl === opt.url;
        const d = dims[opt.url];
        const isBest = !opt.uploaded && best === opt.url;

        let ariaLabel: string;
        if (opt.uploaded) {
          ariaLabel = `${t("coverPhoto")} (uploaded)`;
        } else if (isBest) {
          ariaLabel = `${t("coverPhoto")}, ${t("coverBestQuality")}${
            d && d.w > 0 ? `, ${d.w} by ${d.h}` : ""
          }`;
        } else {
          ariaLabel = `${t("coverPhoto")}${
            d && d.w > 0 ? `, ${d.w} by ${d.h}` : ""
          }`;
        }

        return (
          <button
            key={opt.url}
            type="button"
            title={d && d.w > 0 ? `${d.w}×${d.h}` : undefined}
            aria-label={ariaLabel}
            aria-pressed={selected}
            onClick={() => {
              userPicked.current = true;
              onSelectPhoto(opt.url);
            }}
            className={[
              "relative size-11 overflow-hidden rounded-md cursor-pointer shadow-[0_0_0_1px_var(--border)]",
              selected ? "ring-2 ring-foreground" : "ring-2 ring-transparent",
            ].join(" ")}
          >
            <MeasuredThumb url={opt.url} onMeasure={recordDim} />
            {isBest && (
              <span
                aria-hidden
                className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-jigsaw-secondary text-white shadow-[0_0_0_2px_var(--card)]"
              >
                <Check className="size-2.5" strokeWidth={3} />
              </span>
            )}
          </button>
        );
      })}

      {/* Colour swatches */}
      {COVER_SWATCHES.map((c, i) => {
        const selected = mode === "color" && color === c;
        return (
          <button
            key={c}
            type="button"
            aria-label={`Cover colour ${i + 1}`}
            aria-pressed={selected}
            onClick={() => onSelectColor(c)}
            style={{
              background: `linear-gradient(140deg, ${c}, color-mix(in oklab, ${c}, black 30%))`,
            }}
            className={[
              "size-9 rounded-md cursor-pointer shadow-[0_0_0_1px_var(--border)]",
              selected ? "ring-2 ring-foreground" : "ring-2 ring-transparent",
            ].join(" ")}
          />
        );
      })}

      {/* Upload photo */}
      <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border px-3.5 text-sm font-semibold text-muted-foreground hover:bg-accent">
        <Upload className="size-3.5" /> {t("uploadPhoto")}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUploadPhoto(file);
          }}
        />
      </label>
    </div>
  );
}

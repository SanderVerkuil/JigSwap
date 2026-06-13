// apps/web/src/components/add-puzzle/cover-colour-field.tsx
import { Upload } from "lucide-react";
import { useTranslations } from "use-intl";
import { COVER_SWATCHES } from "./add-puzzle-schema";

export function CoverColourField({
  color,
  mode,
  photoUrl,
  onSelectColor,
  onSelectPhoto,
  onUploadPhoto,
}: {
  color: string;
  mode: "color" | "photo";
  photoUrl?: string;
  onSelectColor: (c: string) => void;
  onSelectPhoto: () => void;
  onUploadPhoto: (file: File) => void;
}) {
  const t = useTranslations("puzzles");
  return (
    <div className="flex flex-wrap gap-2.5">
      {/* Photo thumbnail — shown only when a photo exists */}
      {photoUrl && (
        <button
          type="button"
          aria-label={t("coverPhoto")}
          aria-pressed={mode === "photo"}
          onClick={onSelectPhoto}
          className={[
            "size-9 overflow-hidden rounded-md cursor-pointer shadow-[0_0_0_1px_var(--border)]",
            mode === "photo"
              ? "ring-2 ring-foreground"
              : "ring-2 ring-transparent",
          ].join(" ")}
        >
          <img src={photoUrl} alt="" className="size-full object-cover" />
        </button>
      )}

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

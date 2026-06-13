// apps/web/src/components/add-puzzle/cover-colour-field.tsx
import { Upload } from "lucide-react";
import { useTranslations } from "use-intl";
import { COVER_SWATCHES } from "./add-puzzle-schema";

export function CoverColourField({
  color,
  hasPhoto,
  onColor,
  onPhoto,
}: {
  color: string;
  hasPhoto: boolean;
  onColor: (c: string) => void;
  onPhoto: (file: File) => void;
}) {
  const t = useTranslations("puzzles");
  return (
    <div className="flex flex-wrap gap-2.5">
      {COVER_SWATCHES.map((c, i) => {
        const selected = color === c && !hasPhoto;
        return (
          <button
            key={c}
            type="button"
            aria-label={`Cover colour ${i + 1}`}
            aria-pressed={selected}
            onClick={() => onColor(c)}
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
      <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border px-3.5 text-sm font-semibold text-muted-foreground hover:bg-accent">
        <Upload className="size-3.5" /> {t("uploadPhoto")}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPhoto(file);
          }}
        />
      </label>
    </div>
  );
}

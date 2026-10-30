// apps/web/src/components/add-puzzle/live-preview-card.tsx
import { Badge } from "@/components/ui/badge";
import { Check, Puzzle } from "lucide-react";
import { useTranslations } from "use-intl";

export interface LivePreviewProps {
  title: string;
  brand: string;
  pieceCount: number | undefined;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  // Only a picture the submit will actually save; without one the card shows a neutral placeholder.
  coverPhotoUrl?: string;
  available: boolean;
}

export function LivePreviewCard(props: LivePreviewProps) {
  const t = useTranslations("puzzles");
  const cover = props.coverPhotoUrl
    ? {
        backgroundImage: `url(${props.coverPhotoUrl})`,
        backgroundSize: "cover",
      }
    : undefined;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="relative aspect-square w-full bg-muted" style={cover}>
        {!props.coverPhotoUrl && (
          <Puzzle
            aria-hidden
            className="absolute left-1/2 top-[40%] size-14 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/40"
          />
        )}
        {props.available && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-jigsaw-secondary-strong px-2.5 py-1 text-xs font-semibold text-white">
            <span className="size-1.5 rounded-full bg-white" />{" "}
            {t("previewAvailable")}
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent p-4">
          <div className="font-semibold text-white">
            {props.title || t("previewTitlePlaceholder")}
          </div>
          <div className="text-sm text-white/80">
            {props.brand || t("previewBrandPlaceholder")}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <span className="text-sm">
          {props.pieceCount != null ? (
            <>
              <span className="font-semibold">{props.pieceCount}</span>{" "}
              {t("pieces")}
            </>
          ) : (
            `— ${t("pieces")}`
          )}
        </span>
        {props.difficulty && (
          <Badge variant="outline">{t(`difficulty_${props.difficulty}`)}</Badge>
        )}
      </div>
    </div>
  );
}

/**
 * Below lg the live preview is hidden: this one-row recap of what the submit adds stands in for
 * it, placed right above the submit buttons. Renders nothing until there is a title.
 */
export function AddPuzzleSummary({
  title,
  brand,
  pieceCount,
  coverPhotoUrl,
  offers = [],
}: {
  title: string;
  brand: string;
  pieceCount: number | undefined;
  coverPhotoUrl?: string;
  offers?: ReadonlyArray<string>;
}) {
  const t = useTranslations("puzzles");
  if (!title.trim()) return null;
  const details = [
    brand,
    pieceCount != null ? `${pieceCount} ${t("pieces")}` : "",
    ...offers,
  ].filter((d) => d.length > 0);
  return (
    <div
      data-testid="add-summary"
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-2.5 lg:hidden"
    >
      <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {coverPhotoUrl ? (
          <img src={coverPhotoUrl} alt="" className="size-full object-cover" />
        ) : (
          <Puzzle aria-hidden className="size-5 text-muted-foreground/60" />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{title}</div>
        {details.length > 0 && (
          <div className="truncate text-xs text-muted-foreground">
            {details.join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReadinessChecklist({
  items,
}: {
  items: ReadonlyArray<{ ok: boolean; label: string }>;
}) {
  const t = useTranslations("puzzles");
  return (
    <div className="flex flex-col gap-2.5 border-t border-border pt-3">
      {items.map((c) => (
        <div
          key={c.label}
          className={[
            "flex items-center gap-2.5 text-sm",
            c.ok ? "text-foreground" : "text-muted-foreground",
          ].join(" ")}
        >
          <span
            className={[
              "inline-flex size-[18px] items-center justify-center rounded-full",
              c.ok ? "bg-jigsaw-secondary-strong text-white" : "bg-muted",
            ].join(" ")}
          >
            <span className="sr-only">
              {c.ok ? t("checkDone") : t("checkNotDone")}
            </span>
            {c.ok && <Check className="size-3" />}
          </span>
          {c.label}
        </div>
      ))}
    </div>
  );
}

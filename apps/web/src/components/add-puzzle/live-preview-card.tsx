// apps/web/src/components/add-puzzle/live-preview-card.tsx
import { PuzzleCardShell } from "@/components/puzzles/puzzle-card-shell";
import { Badge } from "@/components/ui/badge";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { cn } from "@/lib/utils";
import { ArrowLeftRight, Check, Puzzle } from "lucide-react";
import type { ComponentProps } from "react";
import { useFormatter, useTranslations } from "use-intl";

export interface LivePreviewProps {
  title: string;
  brand: string;
  pieceCount: number | undefined;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  // Only a picture the submit will actually save; without one the card shows a neutral placeholder.
  coverPhotoUrl?: string;
  available: boolean;
}

type CopyCardData = ComponentProps<typeof PuzzleCard>["puzzle"];

/**
 * The add form's preview: the real My Puzzles card, built from the form, so it can't drift from
 * what the member gets. No link and no actions: there is no copy yet.
 */
export function CopyPreviewCard({
  title,
  brand,
  pieceCount,
  difficulty,
  tags,
  condition,
  availability,
  coverPhotoUrl,
}: {
  title: string;
  brand: string;
  pieceCount: number | undefined;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  tags?: readonly string[];
  condition: CopyCardData["condition"];
  availability: CopyCardData["availability"];
  // Only a picture the submit will actually save.
  coverPhotoUrl?: string;
}) {
  const t = useTranslations("puzzles");
  const puzzle: CopyCardData = {
    _id: "preview",
    puzzleId: "preview",
    condition,
    availability,
    visibility: "visible",
    coverUrl: coverPhotoUrl,
    createdAt: 0,
    updatedAt: 0,
    puzzle: {
      _id: "preview",
      title: title || t("previewTitlePlaceholder"),
      brand: brand || undefined,
      pieceCount: pieceCount ?? 0,
      difficulty,
      tags: tags ? [...tags] : undefined,
      createdAt: 0,
      updatedAt: 0,
    },
  };
  return (
    <PuzzleViewProvider viewMode="grid" className="">
      <PuzzleCard
        puzzle={puzzle}
        viewBasePath=""
        imageFit="contain"
        showActions={false}
        headingLevel={2}
      />
    </PuzzleViewProvider>
  );
}

/**
 * The contribute form's preview: the catalogue card's own shell, built from the form, so it looks
 * like the card the puzzle gets once approved. Title and brand sit under the cover, never on it.
 * No link and no actions: there is no puzzle yet. Unfilled, title and brand show their
 * placeholders in muted text.
 */
export function LivePreviewCard(props: LivePreviewProps) {
  const t = useTranslations("puzzles");
  return (
    <PuzzleViewProvider viewMode="grid" className="">
      <PuzzleCardShell
        puzzle={{
          id: "preview",
          title: props.title || t("previewTitlePlaceholder"),
          brand: props.brand || t("previewBrandPlaceholder"),
          pieceCount: props.pieceCount,
          difficulty: props.difficulty,
          imageUrl: props.coverPhotoUrl,
        }}
        imageFit="contain"
        // The preview sits under the page's h1, like CopyPreviewCard.
        headingLevel={2}
        className={cn(!props.title && "[&_h2]:text-muted-foreground")}
        badges={
          props.available ? (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className="border-jigsaw-secondary/40 bg-jigsaw-secondary-tint text-green-800 dark:text-green-300"
              >
                <ArrowLeftRight aria-hidden />
                {t("previewAvailable")}
              </Badge>
            </div>
          ) : undefined
        }
      />
    </PuzzleViewProvider>
  );
}

/**
 * Below xl the live preview is hidden: this one-row recap of what the submit adds stands in for
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
  const format = useFormatter();
  if (!title.trim()) return null;
  const details = [
    brand,
    pieceCount != null
      ? `${format.number(pieceCount)} ${t("pieces", { count: pieceCount })}`
      : "",
    ...offers,
  ].filter((d) => d.length > 0);
  return (
    <div
      data-testid="add-summary"
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-2.5 xl:hidden"
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

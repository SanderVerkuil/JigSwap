import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { gateway, Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useTranslations } from "use-intl";

// The active `?puzzle=` filter on Browse, shown as a removable pill with the definition's title.
// Same pill chrome as the query builder's condition shells. A malformed or unknown id (the query
// errors or resolves null) falls back to a generic label so the chip stays removable.
export function PuzzleFilterChip({
  puzzleId,
  onRemove,
}: {
  puzzleId: string;
  onRemove: () => void;
}) {
  const t = useTranslations("browsePuzzleFilter");
  const { data, isPending } = useQuery(
    convexQuery(gateway.catalog.puzzleById, {
      puzzleId: puzzleId as Id<"puzzles">,
    }),
  );
  const title = data?.title ?? (isPending ? "…" : t("unknownPuzzle"));

  return (
    <div className="border-input bg-card flex w-fit items-center gap-1.5 rounded-full border py-0.5 pr-1 pl-2.5">
      <Badge
        variant="outline"
        className="border-jigsaw-primary/30 text-jigsaw-primary bg-jigsaw-primary/10 rounded-full px-2 py-0 text-[11px] font-medium"
      >
        {t("label")}
      </Badge>
      <span className="text-foreground text-sm font-medium">{title}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label={t("remove", { title })}
        className="text-muted-foreground hover:text-foreground size-6 rounded-full"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

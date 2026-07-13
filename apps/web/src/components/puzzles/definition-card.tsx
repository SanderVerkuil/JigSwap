"use client";

import { Badge } from "@/components/ui/badge";
import { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";
import { Star } from "lucide-react";
import { useTranslations } from "use-intl";
import { PuzzleCardShell } from "./puzzle-card-shell";

// One card in the public catalog list, derived from the paginated public-browse read this card is
// fed by. Sibling of PuzzleCard (which renders an owned-copy DTO with owner actions) — this one is
// deliberately member-free: no owner identities, no copy-level badges, just catalog facts +
// community aggregates.
type CatalogCard = FunctionReturnType<
  typeof gateway.catalog.publicBrowse
>["page"][number];

export function DefinitionCard({ card }: { card: CatalogCard }) {
  const t = useTranslations("publicCatalog");

  const badges = (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {card.rating.count > 0 && (
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          {card.rating.value} ({card.rating.count})
        </span>
      )}
      {card.availableToSwap > 0 && (
        <Badge variant="outline" className="text-xs">
          {t("toSwap", { count: card.availableToSwap })}
        </Badge>
      )}
    </div>
  );

  return (
    <PuzzleCardShell
      puzzle={{
        id: card._id,
        title: card.title,
        brand: card.brand,
        pieceCount: card.pieceCount,
        difficulty: card.difficulty,
        imageUrl: card.image,
      }}
      badges={badges}
      imageHref={`/catalog/${card._id}`}
    />
  );
}

"use client";

import { Card, CardContent } from "@/components/ui/card";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Grid } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";

import { PageLoading } from "@/components/ui/loading";
import { PuzzleDetailActions } from "./puzzle-detail-actions";
import { PuzzleDetailHeader } from "./puzzle-detail-header";
import { PuzzleDetailInfo } from "./puzzle-detail-info";

interface PuzzleDetailProps {
  ownedPuzzleId: Id<"ownedPuzzles">;
  showActions?: boolean;
  onEdit?: (puzzleId: Id<"ownedPuzzles">) => void;
  onView?: (puzzleId: Id<"ownedPuzzles">) => void;
  onDelete?: (puzzleId: Id<"ownedPuzzles">) => void;
  onRequestExchange?: (puzzleId: Id<"ownedPuzzles">) => void;
  onMessage?: (puzzleId: Id<"ownedPuzzles">) => void;
  onFavorite?: (puzzleId: Id<"ownedPuzzles">) => void;
  showOwner?: boolean;
  className?: string;
}

export function PuzzleDetail({
  ownedPuzzleId,
  showActions = true,
  onEdit,
  onView,
  onDelete,
  onRequestExchange,
  onMessage,
  onFavorite,
  showOwner = false,
  className = "",
}: PuzzleDetailProps) {
  const t = useTranslations("puzzles");

  const ownedPuzzle = useQuery(api.puzzles.getOwnedPuzzleWithCollectionStatus, {
    ownedPuzzleId,
  });

  if (ownedPuzzle === undefined) {
    return <PageLoading message="Loading puzzle..." />;
  }

  if (ownedPuzzle === null) {
    return <div>{t("notFound")}</div>;
  }

  // Early return if no puzzle data
  if (!ownedPuzzle.puzzle) {
    return <div>{t("notFound")}</div>;
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <PuzzleDetailHeader puzzle={ownedPuzzle} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Image */}
        <Card>
          <CardContent className="p-0">
            <div className="aspect-square bg-muted rounded-t-lg relative overflow-hidden">
              {ownedPuzzle.images && ownedPuzzle.images.length > 0 ? (
                <Image
                  src={ownedPuzzle.images[0].fileId}
                  alt={ownedPuzzle.puzzle.title}
                  className="w-full h-full object-cover"
                  width={500}
                  height={500}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-2 rounded bg-muted-foreground/10 flex items-center justify-center">
                      <Grid className="h-6 w-6" />
                    </div>
                    <p className="text-sm">{t("noImage")}</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Info */}
        <div className="space-y-6">
          <PuzzleDetailInfo puzzle={ownedPuzzle} showOwner={showOwner} />

          {showActions && (
            <PuzzleDetailActions
              puzzle={ownedPuzzle}
              onEdit={onEdit}
              onView={onView}
              onDelete={onDelete}
              onRequestExchange={onRequestExchange}
              onMessage={onMessage}
              onFavorite={onFavorite}
            />
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { Card, CardContent } from "@/components/ui/card";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Grid } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { PuzzleDetailActions } from "./puzzle-detail-actions";
import { PuzzleDetailHeader } from "./puzzle-detail-header";
import { PuzzleDetailInfo } from "./puzzle-detail-info";

interface PuzzleDetailProps {
  puzzleId: Id<"puzzles">;
  showActions?: boolean;
  onEdit?: (puzzleId: Id<"puzzles">) => void;
  onView?: (puzzleId: Id<"puzzles">) => void;
  onDelete?: (puzzleId: Id<"puzzles">) => void;
  onRequestTrade?: (puzzleId: Id<"puzzles">) => void;
  onMessage?: (puzzleId: Id<"puzzles">) => void;
  onFavorite?: (puzzleId: Id<"puzzles">) => void;
  showOwner?: boolean;
  className?: string;
}

export function PuzzleDetail({
  puzzleId,
  showActions = true,
  onEdit,
  onView,
  onDelete,
  onRequestTrade,
  onMessage,
  onFavorite,
  showOwner = false,
  className = "",
}: PuzzleDetailProps) {
  const router = useRouter();
  const t = useTranslations("puzzles");

  const puzzle = useQuery(api.puzzles.getPuzzleWithCollectionStatus, {
    puzzleId,
  });

  if (!puzzle) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading puzzle...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <PuzzleDetailHeader puzzle={puzzle} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Image */}
        <Card>
          <CardContent className="p-0">
            <div className="aspect-square bg-muted rounded-t-lg relative overflow-hidden">
              {puzzle.images && puzzle.images.length > 0 ? (
                <Image
                  src={puzzle.images[0]}
                  alt={puzzle.title}
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
          <PuzzleDetailInfo puzzle={puzzle} showOwner={showOwner} />

          {showActions && (
            <PuzzleDetailActions
              puzzle={puzzle}
              onEdit={onEdit}
              onView={onView}
              onDelete={onDelete}
              onRequestTrade={onRequestTrade}
              onMessage={onMessage}
              onFavorite={onFavorite}
            />
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { Card, CardContent } from "@/components/ui/card";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Grid } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { PageLoading } from "@/components/ui/loading";
import { PuzzleDetailActions } from "./puzzle-detail-actions";
import { PuzzleDetailHeader } from "./puzzle-detail-header";
import { PuzzleDetailInfo } from "./puzzle-detail-info";

interface PuzzleDetailProps {
  puzzleId: Id<"puzzleInstances">;
  showActions?: boolean;
  onEdit?: (puzzleId: Id<"puzzleInstances">) => void;
  onView?: (puzzleId: Id<"puzzleInstances">) => void;
  onDelete?: (puzzleId: Id<"puzzleInstances">) => void;
  onRequestTrade?: (puzzleId: Id<"puzzleInstances">) => void;
  onMessage?: (puzzleId: Id<"puzzleInstances">) => void;
  onFavorite?: (puzzleId: Id<"puzzleInstances">) => void;
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

  const puzzleInstance = useQuery(api.puzzles.getPuzzleWithCollectionStatus, {
    puzzleId,
  });

  if (puzzleInstance === undefined) {
    return <PageLoading message="Loading puzzle..." />;
  }

  if (puzzleInstance === null) {
    return <div>{t("notFound")}</div>;
  }

  // Early return if no product data
  if (!puzzleInstance.product) {
    return <div>{t("notFound")}</div>;
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <PuzzleDetailHeader puzzle={puzzleInstance} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Image */}
        <Card>
          <CardContent className="p-0">
            <div className="aspect-square bg-muted rounded-t-lg relative overflow-hidden">
              {puzzleInstance.images && puzzleInstance.images.length > 0 ? (
                <Image
                  src={puzzleInstance.images[0]}
                  alt={puzzleInstance.product.title}
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
          <PuzzleDetailInfo puzzle={puzzleInstance} showOwner={showOwner} />

          {showActions && (
            <PuzzleDetailActions
              puzzle={puzzleInstance}
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

"use client";

import { Button } from "@/components/ui/button";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { Edit, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

interface CollectionData {
  _id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  puzzles?: Array<{
    _id: Id<"ownedPuzzles">;
    puzzleId: Id<"puzzles">;
    puzzle: {
      _id: Id<"puzzles">;
      title: string;
      brand?: string;
    } | null;
  }>;
}

interface CollectionDetailActionsProps {
  collection: CollectionData;
  onEdit?: () => void;
  onAddPuzzles?: () => void;
}

export function CollectionDetailActions({
  collection,
  onEdit,
  onAddPuzzles,
}: CollectionDetailActionsProps) {
  const t = useTranslations("collections");

  return (
    <div className="flex items-center justify-end space-x-2 pt-6">
      {onEdit && (
        <Button variant="outline" onClick={onEdit}>
          <Edit className="h-4 w-4 mr-2" />
          Edit Collection
        </Button>
      )}
      {onAddPuzzles && (
        <Button onClick={onAddPuzzles}>
          <Plus className="h-4 w-4 mr-2" />
          {t("addPuzzles")}
        </Button>
      )}
    </div>
  );
}

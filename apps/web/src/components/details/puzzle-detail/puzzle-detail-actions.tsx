"use client";

import { Button } from "@/components/ui/button";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { Edit, Eye, Heart, MessageCircle, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

interface PuzzleData {
  _id: Id<"puzzleInstances">;
  productId: Id<"puzzleProducts">;
  ownerId: Id<"users">;
  condition: "excellent" | "good" | "fair" | "poor";
  isAvailable: boolean;
  acquisitionDate?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  _creationTime?: number;
  product: {
    _id: Id<"puzzleProducts">;
    title: string;
    description?: string;
    brand?: string;
    pieceCount: number;
    difficulty?: "easy" | "medium" | "hard" | "expert";
    category?: Id<"adminCategories">;
    tags?: string[];
    images?: string[];
    createdAt: number;
    updatedAt: number;
    _creationTime?: number;
  } | null;
  owner?: {
    _id: Id<"users">;
    name: string;
    username?: string;
    avatar?: string;
  } | null;
}

interface PuzzleDetailActionsProps {
  puzzle: PuzzleData;
  onEdit?: (puzzleId: Id<"puzzleInstances">) => void;
  onView?: (puzzleId: Id<"puzzleInstances">) => void;
  onDelete?: (puzzleId: Id<"puzzleInstances">) => void;
  onRequestTrade?: (puzzleId: Id<"puzzleInstances">) => void;
  onMessage?: (puzzleId: Id<"puzzleInstances">) => void;
  onFavorite?: (puzzleId: Id<"puzzleInstances">) => void;
}

export function PuzzleDetailActions({
  puzzle,
  onEdit,
  onView,
  onDelete,
  onRequestTrade,
  onMessage,
  onFavorite,
}: PuzzleDetailActionsProps) {
  const t = useTranslations("puzzles");

  return (
    <div className="space-y-4">
      {/* Primary Actions */}
      <div className="flex flex-col sm:flex-row gap-2">
        {onRequestTrade && puzzle.isAvailable && (
          <Button className="flex-1">{t("requestTrade")}</Button>
        )}
        {onEdit && (
          <Button variant="outline" onClick={() => onEdit(puzzle._id)}>
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
        )}
        {onView && (
          <Button variant="outline" onClick={() => onView(puzzle._id)}>
            <Eye className="h-4 w-4 mr-2" />
            View
          </Button>
        )}
      </div>

      {/* Secondary Actions */}
      <div className="flex items-center gap-2">
        {onFavorite && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onFavorite(puzzle._id)}
          >
            <Heart className="h-4 w-4" />
          </Button>
        )}
        {onMessage && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onMessage(puzzle._id)}
          >
            <MessageCircle className="h-4 w-4" />
          </Button>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(puzzle._id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

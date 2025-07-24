"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { Eye, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { usePuzzleProductView } from "./puzzle-product-view-provider";

interface PuzzleProduct {
  _id: Id<"puzzleProducts">;
  title: string;
  description?: string;
  brand?: string;
  pieceCount: number;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  category?: Id<"adminCategories">;
  tags?: string[];
  image?: string;
  createdAt: number;
  updatedAt: number;
}

interface PuzzleProductCardProps {
  product: PuzzleProduct;
  onAddPuzzle: (productId: Id<"puzzleProducts">) => void;
  onViewDetails: (productId: Id<"puzzleProducts">) => void;
}

export function PuzzleProductCard({
  product,
  onAddPuzzle,
  onViewDetails,
}: PuzzleProductCardProps) {
  const t = useTranslations("puzzles.products");
  const tPuzzles = useTranslations("puzzles");
  const { viewMode } = usePuzzleProductView();

  const getDifficultyColor = (difficulty?: string) => {
    switch (difficulty) {
      case "easy":
        return "bg-green-100 text-green-800";
      case "medium":
        return "bg-yellow-100 text-yellow-800";
      case "hard":
        return "bg-orange-100 text-orange-800";
      case "expert":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getDifficultyLabel = (difficulty?: string) => {
    switch (difficulty) {
      case "easy":
        return t("difficulty.easy");
      case "medium":
        return t("difficulty.medium");
      case "hard":
        return t("difficulty.hard");
      case "expert":
        return t("difficulty.expert");
      default:
        return t("difficulty.unknown");
    }
  };

  const renderImage = () => {
    if (product.image) {
      return (
        <div
          className={`${viewMode === "list" ? "h-32" : "aspect-square"} rounded-lg overflow-hidden bg-muted`}
        >
          <Image
            src={product.image}
            alt={product.title}
            className="w-full h-full object-cover"
          />
        </div>
      );
    } else {
      return (
        <div
          className={`${viewMode === "list" ? "h-32" : "aspect-square"} rounded-lg bg-muted flex items-center justify-center`}
        >
          <div className="text-muted-foreground text-center">
            <div className="text-2xl mb-2">🧩</div>
            <div className="text-sm">{t("noImage")}</div>
          </div>
        </div>
      );
    }
  };

  const renderContent = () => {
    return (
      <div className="flex-1">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg leading-tight line-clamp-2">
              {product.title}
            </h3>
            {product.brand && (
              <p className="text-sm text-muted-foreground mt-1">
                {product.brand}
              </p>
            )}
          </div>
        </div>

        {/* Description */}
        {product.description && (
          <p className="text-sm text-muted-foreground mb-4 line-clamp-3">
            {product.description}
          </p>
        )}

        {/* Product Details */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {tPuzzles("pieceCount")}
            </span>
            <span className="text-sm">
              {product.pieceCount} {tPuzzles("pieces")}
            </span>
          </div>

          {product.difficulty && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {tPuzzles("difficulty")}
              </span>
              <Badge
                variant="secondary"
                className={`text-xs ${getDifficultyColor(product.difficulty)}`}
              >
                {getDifficultyLabel(product.difficulty)}
              </Badge>
            </div>
          )}
        </div>

        {/* Tags */}
        {product.tags && product.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {product.tags.slice(0, 3).map((tag, index) => (
              <Badge key={index} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
            {product.tags.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{product.tags.length - 3}
              </Badge>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onViewDetails(product._id)}
            className="flex-1"
          >
            <Eye className="h-4 w-4 mr-2" />
            {t("viewDetails")}
          </Button>
          <Button
            size="sm"
            onClick={() => onAddPuzzle(product._id)}
            className="flex-1"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t("addPuzzle")}
          </Button>
        </div>
      </div>
    );
  };

  if (viewMode === "list") {
    return (
      <Card className="h-full">
        <div className="flex">
          <div className="w-32 flex-shrink-0">{renderImage()}</div>
          <div className="flex-1 p-4">{renderContent()}</div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg leading-tight line-clamp-2">
              {product.title}
            </h3>
            {product.brand && (
              <p className="text-sm text-muted-foreground mt-1">
                {product.brand}
              </p>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col">
        {/* Product Image */}
        {renderImage()}

        {/* Description */}
        {product.description && (
          <p className="text-sm text-muted-foreground mb-4 line-clamp-3">
            {product.description}
          </p>
        )}

        {/* Product Details */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {tPuzzles("pieceCount")}
            </span>
            <span className="text-sm">
              {product.pieceCount} {tPuzzles("pieces")}
            </span>
          </div>

          {product.difficulty && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {tPuzzles("difficulty")}
              </span>
              <Badge
                variant="secondary"
                className={`text-xs ${getDifficultyColor(product.difficulty)}`}
              >
                {getDifficultyLabel(product.difficulty)}
              </Badge>
            </div>
          )}
        </div>

        {/* Tags */}
        {product.tags && product.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {product.tags.slice(0, 3).map((tag, index) => (
              <Badge key={index} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
            {product.tags.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{product.tags.length - 3}
              </Badge>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onViewDetails(product._id)}
            className="flex-1"
          >
            <Eye className="h-4 w-4 mr-2" />
            {t("viewDetails")}
          </Button>
          <Button
            size="sm"
            onClick={() => onAddPuzzle(product._id)}
            className="flex-1"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t("addPuzzle")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

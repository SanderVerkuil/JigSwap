"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import {
  Check,
  Edit,
  Eye,
  Heart,
  MessageCircle,
  Trash2,
  User,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { createContext, ReactNode, useContext } from "react";
import { CollectionDropdown } from "./collection-dropdown";

// Context for view mode
type ViewMode = "grid" | "list";

interface PuzzleViewContextType {
  viewMode: ViewMode;
}

const PuzzleViewContext = createContext<PuzzleViewContextType | undefined>(
  undefined,
);

export function usePuzzleView() {
  const context = useContext(PuzzleViewContext);
  if (!context) {
    throw new Error("usePuzzleView must be used within a PuzzleViewProvider");
  }
  return context;
}

interface PuzzleViewProviderProps {
  children: ReactNode;
  viewMode: ViewMode;
}

export function PuzzleViewProvider({
  children,
  viewMode,
}: PuzzleViewProviderProps) {
  return (
    <PuzzleViewContext.Provider value={{ viewMode }}>
      <div
        className={
          viewMode === "grid"
            ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
            : "space-y-4"
        }
      >
        {children}
      </div>
    </PuzzleViewContext.Provider>
  );
}

// Puzzle instance data type with puzzle information
interface OwnedPuzzleData {
  _id: Id<"ownedPuzzles">;
  puzzleId: Id<"puzzles">;
  ownerId: Id<"users">;
  condition: "new_sealed" | "like_new" | "good" | "fair" | "poor";
  availability: {
    forTrade: boolean;
    forSale: boolean;
    forLend: boolean;
  };
  acquisitionDate?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  _creationTime?: number;
  addedAt?: number; // For collection members
  puzzle: {
    _id: Id<"puzzles">;
    title: string;
    description?: string;
    brand?: string;
    pieceCount: number;
    difficulty?: "easy" | "medium" | "hard" | "expert";
    category?: Id<"adminCategories">;
    tags?: string[];
    images?: string[]; // Make optional to match backend schema
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

interface PuzzleCardProps {
  puzzle: OwnedPuzzleData;
  variant?: "default" | "browse" | "collection" | "selection";
  onEdit?: (puzzleId: Id<"ownedPuzzles">) => void;
  onView?: (puzzleId: Id<"ownedPuzzles">) => void;
  onDelete?: (puzzleId: Id<"ownedPuzzles">) => void;
  onRemove?: (puzzleId: Id<"ownedPuzzles">) => void;
  onSelect?: (puzzleId: Id<"ownedPuzzles">) => void;
  onRequestExchange?: (puzzleId: Id<"ownedPuzzles">) => void;
  onMessage?: (puzzleId: Id<"ownedPuzzles">) => void;
  onFavorite?: (puzzleId: Id<"ownedPuzzles">) => void;
  isSelected?: boolean;
  showOwner?: boolean;
  showActions?: boolean;
  showAvailability?: boolean;
  showCollectionDropdown?: boolean;
  className?: string;
}

export function PuzzleCard({
  puzzle,
  variant = "default",
  onEdit,
  onView,
  onDelete,
  onRemove,
  onSelect,
  onRequestExchange,
  onMessage,
  onFavorite,
  isSelected = false,
  showOwner = false,
  showActions = true,
  showAvailability = true,
  showCollectionDropdown = false,
  className = "",
}: PuzzleCardProps) {
  const t = useTranslations("puzzles");
  const { viewMode } = usePuzzleView();

  // Early return if no puzzle data
  if (!puzzle.puzzle) {
    return null;
  }

  const renderImage = () => {
    const imageUrl = puzzle.puzzle?.images?.[0] || "/placeholder-puzzle.jpg";
    return (
      <div className="relative aspect-square overflow-hidden rounded-t-lg">
        <Image
          src={imageUrl}
          alt={puzzle.puzzle?.title || "Puzzle"}
          fill
          className="object-cover transition-transform hover:scale-105"
        />
        {isSelected && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
            <Check className="h-8 w-8 text-primary" />
          </div>
        )}
        {variant === "selection" && (
          <div className="absolute top-2 right-2">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onSelect?.(puzzle._id)}
              className="h-4 w-4"
            />
          </div>
        )}
      </div>
    );
  };

  const renderActions = () => {
    if (!showActions) return null;

    return (
      <div className="flex items-center gap-2">
        {onView && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onView(puzzle._id)}
            className="h-8 w-8 p-0"
          >
            <Eye className="h-4 w-4" />
          </Button>
        )}
        {onEdit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(puzzle._id)}
            className="h-8 w-8 p-0"
          >
            <Edit className="h-4 w-4" />
          </Button>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(puzzle._id)}
            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(puzzle._id)}
            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
        {onRequestExchange && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRequestExchange(puzzle._id)}
            className="h-8 w-8 p-0"
          >
            <MessageCircle className="h-4 w-4" />
          </Button>
        )}
        {onMessage && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onMessage(puzzle._id)}
            className="h-8 w-8 p-0"
          >
            <MessageCircle className="h-4 w-4" />
          </Button>
        )}
        {onFavorite && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onFavorite(puzzle._id)}
            className="h-8 w-8 p-0"
          >
            <Heart className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  };

  const renderContent = () => {
    return (
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1">
            <h3 className="font-semibold text-sm line-clamp-2 mb-1">
              {puzzle.puzzle?.title || "Unknown Puzzle"}
            </h3>
            {puzzle.puzzle?.brand && (
              <p className="text-xs text-muted-foreground mb-1">
                {puzzle.puzzle.brand}
              </p>
            )}
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="secondary" className="text-xs">
                {puzzle.puzzle?.pieceCount || 0} {t("pieces")}
              </Badge>
              {puzzle.puzzle?.difficulty && (
                <Badge variant="outline" className="text-xs">
                  {puzzle.puzzle.difficulty}
                </Badge>
              )}
              <Badge
                variant={
                  puzzle.condition === "new_sealed" ||
                  puzzle.condition === "like_new"
                    ? "default"
                    : "secondary"
                }
                className="text-xs"
              >
                {puzzle.condition}
              </Badge>
            </div>
          </div>
          {showCollectionDropdown && (
            <CollectionDropdown ownedPuzzleId={puzzle._id} />
          )}
        </div>

        {showAvailability && (
          <div className="flex items-center gap-2 mb-2">
            {puzzle.availability.forLend ? (
              <Badge variant="outline" className="text-xs">
                {t("lend")}
              </Badge>
            ) : null}
            {puzzle.availability.forTrade ? (
              <Badge variant="outline" className="text-xs">
                {t("trade")}
              </Badge>
            ) : null}
            {puzzle.availability.forSale ? (
              <Badge variant="outline" className="text-xs">
                {t("sale")}
              </Badge>
            ) : null}
          </div>
        )}

        {showOwner && puzzle.owner && (
          <div className="flex items-center gap-2 mb-2">
            <User className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {puzzle.owner.name}
            </span>
          </div>
        )}

        {puzzle.puzzle?.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
            {puzzle.puzzle.description}
          </p>
        )}

        {puzzle.puzzle?.tags && puzzle.puzzle.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {puzzle.puzzle.tags.slice(0, 3).map((tag, index) => (
              <Badge key={index} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
            {puzzle.puzzle.tags.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{puzzle.puzzle.tags.length - 3}
              </Badge>
            )}
          </div>
        )}

        {renderActions()}
      </div>
    );
  };

  if (viewMode === "list") {
    return (
      <Card
        className={`${className} ${isSelected ? "ring-2 ring-primary" : ""}`}
      >
        <div className="flex">
          <div className="w-32 flex-shrink-0">{renderImage()}</div>
          <div className="flex-1">{renderContent()}</div>
        </div>
      </Card>
    );
  }

  return (
    <Card className={`${className} ${isSelected ? "ring-2 ring-primary" : ""}`}>
      {renderImage()}
      {renderContent()}
    </Card>
  );
}

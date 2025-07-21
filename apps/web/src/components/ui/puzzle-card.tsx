"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import {
  Check,
  Edit,
  Eye,
  Grid,
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

// Puzzle data type
interface PuzzleData {
  _id: Id<"puzzles">;
  title: string;
  description?: string;
  brand?: string;
  pieceCount: number;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  condition: "excellent" | "good" | "fair" | "poor";
  category?: Id<"adminCategories">;
  tags?: string[];
  images: string[];
  ownerId: Id<"users">;
  isAvailable: boolean;
  isCompleted: boolean;
  completedDate?: number;
  acquisitionDate?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  _creationTime?: number;
  owner?: {
    _id: Id<"users">;
    name: string;
    username?: string;
    avatar?: string;
  } | null;
}

// Props for the PuzzleCard component
interface PuzzleCardProps {
  puzzle: PuzzleData;
  variant?: "default" | "browse" | "collection" | "selection";
  onEdit?: (puzzleId: Id<"puzzles">) => void;
  onView?: (puzzleId: Id<"puzzles">) => void;
  onDelete?: (puzzleId: Id<"puzzles">) => void;
  onRemove?: (puzzleId: Id<"puzzles">) => void;
  onSelect?: (puzzleId: Id<"puzzles">) => void;
  onRequestTrade?: (puzzleId: Id<"puzzles">) => void;
  onMessage?: (puzzleId: Id<"puzzles">) => void;
  onFavorite?: (puzzleId: Id<"puzzles">) => void;
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
  onRequestTrade,
  onMessage,
  onFavorite,
  isSelected = false,
  showOwner = false,
  showActions = true,
  showAvailability = true,
  showCollectionDropdown = false,
  className = "",
}: PuzzleCardProps) {
  const { viewMode } = usePuzzleView();
  const t = useTranslations("puzzles");

  const renderImage = () => {
    const imageContainerClass =
      viewMode === "grid"
        ? "aspect-square bg-muted rounded-t-lg relative overflow-hidden"
        : "w-32 h-32 bg-muted rounded-l-lg flex-shrink-0 relative overflow-hidden";

    const imageClass =
      viewMode === "grid"
        ? "w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
        : "w-full h-full object-cover object-center";

    return (
      <div className={imageContainerClass}>
        {puzzle.images && puzzle.images.length > 0 ? (
          <Image
            src={puzzle.images[0]}
            alt={puzzle.title}
            className={imageClass}
            width={viewMode === "grid" ? 500 : 128}
            height={viewMode === "grid" ? 500 : 128}
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

        {/* Overlay badges and buttons */}
        <div className="absolute top-2 right-2 flex gap-1">
          {showAvailability && viewMode === "grid" && (
            <Badge
              variant={puzzle.isAvailable ? "default" : "secondary"}
              className="text-xs"
            >
              {puzzle.isAvailable ? t("available") : t("unavailable")}
            </Badge>
          )}

          {variant === "selection" && isSelected && (
            <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
              <Check className="h-4 w-4 text-white" />
            </div>
          )}

          {variant === "browse" && onFavorite && (
            <Button
              variant="ghost"
              size="sm"
              className="bg-white/80 hover:bg-white"
              onClick={() => onFavorite(puzzle._id)}
            >
              <Heart className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Action buttons for grid view */}
        {viewMode === "grid" && showActions && (
          <div className="absolute bottom-2 right-2 flex gap-1">
            {variant === "collection" && onRemove && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => onRemove(puzzle._id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderActions = () => {
    return (
      <div className="flex items-center gap-2">
        {variant === "browse" && onRequestTrade && (
          <Button size="sm" className="flex-1">
            {t("requestTrade")}
          </Button>
        )}
        {variant === "browse" && onMessage && (
          <Button variant="outline" size="sm">
            <MessageCircle className="h-4 w-4" />
          </Button>
        )}
        {variant === "default" && showCollectionDropdown && (
          <CollectionDropdown puzzleId={puzzle._id} />
        )}
        {variant === "default" && onView && (
          <Button variant="ghost" size="sm">
            <Eye className="h-4 w-4" />
          </Button>
        )}
        {variant === "default" && onEdit && (
          <Button variant="ghost" size="sm">
            <Edit className="h-4 w-4" />
          </Button>
        )}
        {variant === "default" && onDelete && (
          <Button variant="ghost" size="sm">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  };

  const renderContent = () => {
    if (viewMode === "grid") {
      return (
        <>
          {renderImage()}
          <CardHeader className="pb-2">
            <CardTitle className="text-lg line-clamp-1">
              {puzzle.title}
            </CardTitle>
            <CardDescription className="line-clamp-2">
              {puzzle.brand && (
                <span className="font-medium">{puzzle.brand}</span>
              )}
              {puzzle.brand && puzzle.pieceCount && " • "}
              {puzzle.pieceCount && (
                <span>
                  {puzzle.pieceCount} {t("pieces")}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {puzzle.difficulty && (
                  <Badge variant="outline" className="text-xs">
                    {puzzle.difficulty}
                  </Badge>
                )}
                {puzzle.condition && (
                  <Badge variant="outline" className="text-xs">
                    {puzzle.condition}
                  </Badge>
                )}
              </div>

              {showOwner && puzzle.owner && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-3 w-3" />
                  <span>{puzzle.owner.name}</span>
                </div>
              )}
            </div>
          </CardContent>
        </>
      );
    } else {
      // List view
      return (
        <div className="flex w-full">
          {renderImage()}
          <div className="flex-1 p-4">
            <div className="flex items-start justify-between h-full">
              <div className="flex-1">
                <h3 className="font-semibold text-lg mb-1">{puzzle.title}</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  {puzzle.brand && (
                    <span className="font-medium">{puzzle.brand}</span>
                  )}
                  {puzzle.brand && puzzle.pieceCount && " • "}
                  {puzzle.pieceCount && (
                    <span>
                      {puzzle.pieceCount} {t("pieces")}
                    </span>
                  )}
                </p>
                <div className="flex items-center gap-2 mb-2">
                  {showAvailability && (
                    <Badge
                      variant={puzzle.isAvailable ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {puzzle.isAvailable ? t("available") : t("unavailable")}
                    </Badge>
                  )}
                  {puzzle.difficulty && (
                    <Badge variant="outline" className="text-xs">
                      {puzzle.difficulty}
                    </Badge>
                  )}
                  {puzzle.condition && (
                    <Badge variant="outline" className="text-xs">
                      {puzzle.condition}
                    </Badge>
                  )}
                </div>
                {showOwner && puzzle.owner && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <User className="h-3 w-3" />
                    <span>{puzzle.owner.name}</span>
                  </div>
                )}
              </div>
              {showActions && renderActions()}
            </div>
          </div>
        </div>
      );
    }
  };

  return (
    <Card
      className={`group hover:shadow-lg transition-shadow ${
        viewMode === "list" ? "flex py-0" : "pt-0"
      } ${className}`}
      onClick={
        variant === "selection" && onSelect
          ? () => onSelect(puzzle._id)
          : undefined
      }
    >
      {renderContent()}
      {viewMode === "grid" && (
        <CardFooter className="ml-auto">
          {showActions && renderActions()}
        </CardFooter>
      )}
    </Card>
  );
}

"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { Calendar, User } from "lucide-react";
import { useTranslations } from "next-intl";

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

interface PuzzleDetailInfoProps {
  puzzle: PuzzleData;
  showOwner?: boolean;
}

export function PuzzleDetailInfo({
  puzzle,
  showOwner = false,
}: PuzzleDetailInfoProps) {
  const t = useTranslations("puzzles");

  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle>Puzzle Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Piece Count
              </p>
              <p className="text-lg">
                {puzzle.pieceCount} {t("pieces")}
              </p>
            </div>
            {puzzle.difficulty && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Difficulty
                </p>
                <Badge variant="outline">{puzzle.difficulty}</Badge>
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Condition
              </p>
              <Badge variant="outline">{puzzle.condition}</Badge>
            </div>
            {puzzle.category && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Category
                </p>
                <p className="text-lg">{puzzle.category}</p>
              </div>
            )}
          </div>

          {/* Tags */}
          {puzzle.tags && puzzle.tags.length > 0 && (
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">
                Tags
              </p>
              <div className="flex flex-wrap gap-2">
                {puzzle.tags.map((tag, index) => (
                  <Badge key={index} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Owner Info */}
      {showOwner && puzzle.owner && (
        <Card>
          <CardHeader>
            <CardTitle>Owner</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <User className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">{puzzle.owner.name}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dates */}
      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {puzzle.acquisitionDate && (
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Acquired</p>
                <p className="text-sm text-muted-foreground">
                  {new Date(puzzle.acquisitionDate).toLocaleDateString()}
                </p>
              </div>
            </div>
          )}
          {puzzle.completedDate && (
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Completed</p>
                <p className="text-sm text-muted-foreground">
                  {new Date(puzzle.completedDate).toLocaleDateString()}
                </p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Added to Collection</p>
              <p className="text-sm text-muted-foreground">
                {new Date(puzzle.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      {puzzle.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{puzzle.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

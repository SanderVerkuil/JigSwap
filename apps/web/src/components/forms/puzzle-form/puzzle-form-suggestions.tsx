"use client";

import { api } from "@jigswap/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { UseFormReturn } from "react-hook-form";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormDescription } from "@/components/ui/form";

import { type PuzzleFormData } from "./puzzle-form-schema";

interface PuzzleSuggestion {
  _id: string;
  title: string;
  brand?: string;
  pieceCount: number;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  category?: string;
  tags?: string[];
  description?: string;
}

interface PuzzleFormSuggestionsProps {
  form: UseFormReturn<PuzzleFormData>;
  onSuggestionUsed: () => void;
}

export function PuzzleFormSuggestions({
  form,
  onSuggestionUsed,
}: PuzzleFormSuggestionsProps) {
  const t = useTranslations("puzzles");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Watch the title field for changes
  const titleValue = form.watch("title");

  // Get puzzle suggestions from backend
  const suggestions = useQuery(
    api.puzzles.getPuzzleSuggestions,
    titleValue && titleValue.length >= 2
      ? { searchTerm: titleValue, limit: 5 }
      : "skip",
  );

  // Show suggestions when title has 2+ characters
  useEffect(() => {
    if (titleValue && titleValue.length >= 2) {
      setShowSuggestions(true);
      setIsLoading(true);
    } else {
      setShowSuggestions(false);
      setIsLoading(false);
    }
  }, [titleValue]);

  // Update loading state when suggestions change
  useEffect(() => {
    if (suggestions !== undefined) {
      setIsLoading(false);
    }
  }, [suggestions]);

  const applySuggestion = (suggestion: PuzzleSuggestion) => {
    form.setValue("title", suggestion.title);
    if (suggestion.brand) form.setValue("brand", suggestion.brand);
    if (suggestion.pieceCount)
      form.setValue("pieceCount", suggestion.pieceCount);
    if (suggestion.difficulty)
      form.setValue("difficulty", suggestion.difficulty);
    if (suggestion.category) form.setValue("category", suggestion.category);
    if (suggestion.tags) form.setValue("tags", suggestion.tags);
    if (suggestion.description)
      form.setValue("description", suggestion.description);

    setShowSuggestions(false);
    onSuggestionUsed();
  };

  if (!showSuggestions) {
    return null;
  }

  return (
    <div className="absolute top-full left-0 right-0 z-50 mt-2 animate-in fade-in-0 duration-200">
      <Card className="shadow-lg border-2 max-h-80 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4" />
            {t("suggestions.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <FormDescription className="text-xs">
              {t("suggestions.description")}
            </FormDescription>
          </div>

          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">
                Loading suggestions...
              </span>
            </div>
          )}

          {/* Suggestions */}
          {!isLoading && suggestions && suggestions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">{t("suggestions.found")}</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {suggestions.map((suggestion) => (
                  <Card
                    key={suggestion._id}
                    className="p-3 hover:bg-muted/50 transition-colors cursor-pointer active:bg-muted/70 touch-manipulation"
                    onClick={() => applySuggestion(suggestion)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 flex-1 min-w-0">
                        <h5 className="font-medium text-sm truncate">
                          {suggestion.title}
                        </h5>
                        <div className="flex flex-wrap gap-1 text-xs">
                          {suggestion.brand && (
                            <Badge variant="secondary" className="text-xs">
                              {suggestion.brand}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {suggestion.pieceCount} pieces
                          </Badge>
                          {suggestion.difficulty && (
                            <Badge variant="outline" className="text-xs">
                              {suggestion.difficulty}
                            </Badge>
                          )}
                        </div>
                        {suggestion.tags && suggestion.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {suggestion.tags.slice(0, 2).map((tag: string) => (
                              <Badge
                                key={tag}
                                variant="outline"
                                className="text-xs"
                              >
                                {tag}
                              </Badge>
                            ))}
                            {suggestion.tags.length > 2 && (
                              <Badge variant="outline" className="text-xs">
                                +{suggestion.tags.length - 2}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          applySuggestion(suggestion);
                        }}
                      >
                        {t("suggestions.useThis")}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* No results */}
          {!isLoading && suggestions && suggestions.length === 0 && (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">
                {t("suggestions.noResults")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

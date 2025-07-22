"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useState } from "react";
import { UseFormReturn } from "react-hook-form";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { PuzzleSuggestion } from "@jigswap/backend/convex/puzzles";
import { type PuzzleFormData } from "./puzzle-form-schema";
import { PuzzleFormSuggestions } from "./puzzle-form-suggestions";

// Common puzzle piece counts
const COMMON_PIECE_COUNTS = [
  { value: "500", label: "500 pieces" },
  { value: "1000", label: "1000 pieces" },
  { value: "1500", label: "1500 pieces" },
  { value: "2000", label: "2000 pieces" },
  { value: "3000", label: "3000 pieces" },
  { value: "4000", label: "4000 pieces" },
  { value: "5000", label: "5000 pieces" },
  { value: "custom", label: "Custom amount" },
];

interface PuzzleFormBasicInfoProps {
  form: UseFormReturn<PuzzleFormData>;
  categories?: Array<{ _id: Id<"adminCategories">; name: { en: string } }>;
  onTitleInteraction?: () => void;
  onSuggestionUsed?: () => void;
}

export function PuzzleFormBasicInfo({
  form,
  categories,
  onSuggestionUsed,
}: PuzzleFormBasicInfoProps) {
  const t = useTranslations("puzzles");

  // State for custom piece count input
  const [showCustomPieceCount, setShowCustomPieceCount] = React.useState(false);
  const [customPieceCount, setCustomPieceCount] = React.useState(
    form.getValues("pieceCount")?.toString() || "",
  );

  // Initialize custom piece count state based on default values
  React.useEffect(() => {
    const currentValue = form.getValues("pieceCount");
    if (currentValue) {
      const isCommonValue = COMMON_PIECE_COUNTS.some(
        (option) => parseInt(option.value) === currentValue,
      );
      if (!isCommonValue) {
        setShowCustomPieceCount(true);
        setCustomPieceCount(currentValue.toString());
      }
    }
  }, [form]);

  const handlePieceCountChange = (value: string) => {
    if (value === "custom") {
      setShowCustomPieceCount(true);
      form.setValue("pieceCount", parseInt(customPieceCount) || 1000);
    } else {
      setShowCustomPieceCount(false);
      form.setValue("pieceCount", parseInt(value));
    }
  };

  const handleCustomPieceCountChange = (value: string) => {
    setCustomPieceCount(value);
    if (value) {
      form.setValue("pieceCount", parseInt(value));
    }
  };

  const getCurrentPieceCountValue = () => {
    const currentValue = form.getValues("pieceCount");
    const isCommonValue = COMMON_PIECE_COUNTS.some(
      (option) => parseInt(option.value) === currentValue,
    );
    return isCommonValue ? currentValue?.toString() : "custom";
  };

  const addTag = () => {
    const currentTags = form.getValues("tags") || [];
    const newTag = form.getValues("newTag") || "";
    if (
      typeof newTag === "string" &&
      newTag.trim() &&
      !currentTags.includes(newTag.trim())
    ) {
      form.setValue("tags", [...currentTags, newTag.trim()]);
      form.setValue("newTag", "");
    }
  };

  const removeTag = (tagToRemove: string) => {
    const currentTags = form.getValues("tags") || [];
    form.setValue(
      "tags",
      currentTags.filter((tag) => tag !== tagToRemove),
    );
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  };

  // Watch the title field to determine if we should show other sections
  const titleValue = form.watch("title");
  const [hasUsedSuggestion, setHasUsedSuggestion] = useState(false);

  // Show other sections only after suggestion is used or title loses focus
  const shouldShowOtherSections =
    hasUsedSuggestion || (titleValue && titleValue.trim().length > 0);

  const handleSuggestionUsed = (suggestion: PuzzleSuggestion) => {
    setHasUsedSuggestion(true);
    form.setValue("title", suggestion.title);
    if (suggestion.brand) form.setValue("brand", suggestion.brand);
    if (suggestion.tags) form.setValue("tags", suggestion.tags);
    if (suggestion.description)
      form.setValue("description", suggestion.description);
    onSuggestionUsed?.();
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground mb-6">
          {t("basicInformationDescription")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Title with integrated suggestions */}
        <div className="md:col-span-2">
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("title")}</FormLabel>
                <FormControl>
                  <PuzzleFormSuggestions
                    value={field.value}
                    onChange={field.onChange}
                    onSuggestionUsed={handleSuggestionUsed}
                    placeholder={t("titlePlaceholder")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Show other fields only when title is entered and interacted with */}
        {shouldShowOtherSections && (
          <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
            {/* Description */}
            <div className="md:col-span-2">
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("description")} (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t("descriptionPlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Brand */}
            <FormField
              control={form.control}
              name="brand"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("brand")} (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder={t("brandPlaceholder")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Category */}
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("category")} (optional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("categoryPlaceholder")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories?.map((category) => (
                        <SelectItem key={category._id} value={category._id}>
                          {category.name.en}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Piece Count */}
            <FormField
              control={form.control}
              name="pieceCount"
              render={() => (
                <FormItem>
                  <FormLabel>{t("pieceCount")}</FormLabel>
                  <div className="space-y-2">
                    <Select
                      onValueChange={handlePieceCountChange}
                      value={getCurrentPieceCountValue()}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("selectPieceCount")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {COMMON_PIECE_COUNTS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {showCustomPieceCount && (
                      <FormControl>
                        <Input
                          type="number"
                          placeholder={t("customPieceCountPlaceholder")}
                          value={customPieceCount}
                          onChange={(e) =>
                            handleCustomPieceCountChange(e.target.value)
                          }
                          min="1"
                        />
                      </FormControl>
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Difficulty */}
            <FormField
              control={form.control}
              name="difficulty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("difficulty")} (optional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("selectDifficulty")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="easy">{t("easy")}</SelectItem>
                      <SelectItem value="medium">{t("medium")}</SelectItem>
                      <SelectItem value="hard">{t("hard")}</SelectItem>
                      <SelectItem value="expert">{t("expert")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Condition */}
            <FormField
              control={form.control}
              name="condition"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("condition")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("selectCondition")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="excellent">
                        {t("excellent")}
                      </SelectItem>
                      <SelectItem value="good">{t("good")}</SelectItem>
                      <SelectItem value="fair">{t("fair")}</SelectItem>
                      <SelectItem value="poor">{t("poor")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* Tags - only show when title is entered and interacted with */}
        {shouldShowOtherSections && (
          <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
            <FormField
              control={form.control}
              name="newTag"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("tags")} (optional)</FormLabel>
                  <div className="flex gap-2">
                    <FormControl>
                      <Input
                        placeholder={t("tagsPlaceholder")}
                        {...field}
                        onKeyPress={handleKeyPress}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addTag}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("tagsHelp")}
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Display Tags */}
            {(form.getValues("tags") || []).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {form.getValues("tags")?.map((tag, index) => (
                  <Badge key={index} variant="secondary" className="gap-1">
                    {tag}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 ml-1"
                      onClick={() => removeTag(tag)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

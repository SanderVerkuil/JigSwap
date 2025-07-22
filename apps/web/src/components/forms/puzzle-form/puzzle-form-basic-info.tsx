"use client";

import { Plus, X } from "lucide-react";
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
  onTitleInteraction,
  onSuggestionUsed,
}: PuzzleFormBasicInfoProps) {
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
  const [hasInteractedWithTitle, setHasInteractedWithTitle] = useState(false);
  const [hasUsedSuggestion, setHasUsedSuggestion] = useState(false);

  // Show other sections only after suggestion is used or title loses focus
  const shouldShowOtherSections =
    hasUsedSuggestion ||
    (hasInteractedWithTitle && titleValue && titleValue.trim().length > 0);

  const handleTitleFocus = () => {
    setHasInteractedWithTitle(true);
    onTitleInteraction?.();
  };

  const handleTitleBlur = () => {
    setHasInteractedWithTitle(true);
    onTitleInteraction?.();
  };

  const handleSuggestionUsed = () => {
    setHasUsedSuggestion(true);
    onSuggestionUsed?.();
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">Basic Information</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Enter the essential details about your puzzle
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Title */}
        <div className="md:col-span-2 relative">
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Enter puzzle title"
                    {...field}
                    onFocus={handleTitleFocus}
                    onBlur={handleTitleBlur}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Suggestions appear as overlay */}
          <PuzzleFormSuggestions
            form={form}
            onSuggestionUsed={handleSuggestionUsed}
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
                    <FormLabel>Description (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe your puzzle (optional)"
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
                  <FormLabel>Brand (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Ravensburger, Clementoni"
                      {...field}
                    />
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
                  <FormLabel>Category (optional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="e.g. Landscape, Animals, Art" />
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
                  <FormLabel>Piece Count</FormLabel>
                  <div className="space-y-2">
                    <Select
                      onValueChange={handlePieceCountChange}
                      value={getCurrentPieceCountValue()}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select piece count" />
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
                          placeholder="Enter custom piece count"
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
                  <FormLabel>Difficulty (optional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select difficulty" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="easy">Easy</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="hard">Hard</SelectItem>
                      <SelectItem value="expert">Expert</SelectItem>
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
                  <FormLabel>Condition</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select condition" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="excellent">Excellent</SelectItem>
                      <SelectItem value="good">Good</SelectItem>
                      <SelectItem value="fair">Fair</SelectItem>
                      <SelectItem value="poor">Poor</SelectItem>
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
                  <FormLabel>Tags (optional)</FormLabel>
                  <div className="flex gap-2">
                    <FormControl>
                      <Input
                        placeholder="nature, colorful, challenging"
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
                    Separate tags with commas
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

"use client";

import { useUser } from "@clerk/nextjs";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@jigswap/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Form } from "@/components/ui/form";
import { toast } from "sonner";

import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { PuzzleFormActions } from "./puzzle-form-actions";
import { PuzzleFormBasicInfo } from "./puzzle-form-basic-info";
import { PuzzleFormCompletions } from "./puzzle-form-completions";
import {
  puzzleFormDefaultValues,
  puzzleFormSchema,
  type PuzzleFormData,
} from "./puzzle-form-schema";
import { PuzzleFormStatusInfo } from "./puzzle-form-status-info";

// Import compound form components
import { PuzzleFormForm } from "./puzzle-form-form";
import { PuzzleFormRoot } from "./puzzle-form-root";
import { PuzzleFormTitle } from "./puzzle-form-title";

interface PuzzleFormProps {
  id: string;
  onSuccess?: () => void;
  onCancel?: () => void;
  defaultValues?: Partial<PuzzleFormData>;
  showActions?: boolean;
}

// Legacy component for backward compatibility
export function PuzzleForm({
  id,
  onSuccess,
  onCancel,
  defaultValues = puzzleFormDefaultValues,
  showActions = true,
}: PuzzleFormProps) {
  const { user } = useUser();
  const createPuzzle = useMutation(api.puzzles.createPuzzleWithProduct);

  // Get the current user from the database
  const convexUser = useQuery(
    api.users.getUserByClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

  // Get admin categories
  const categories = useQuery(api.adminCategories.getActiveAdminCategories);

  const form = useForm<PuzzleFormData>({
    resolver: zodResolver(puzzleFormSchema),
    defaultValues,
  });

  // Watch the title field and track interaction states
  const titleValue = form.watch("title");
  const [hasInteractedWithTitle, setHasInteractedWithTitle] = useState(false);
  const [hasUsedSuggestion, setHasUsedSuggestion] = useState(false);

  // Show other sections only after suggestion is used or title loses focus
  const shouldShowOtherSections =
    hasUsedSuggestion ||
    (hasInteractedWithTitle &&
      typeof titleValue === "string" &&
      titleValue.trim().length > 0);

  const handleTitleInteraction = () => {
    setHasInteractedWithTitle(true);
  };

  const handleSuggestionUsed = () => {
    setHasUsedSuggestion(true);
  };

  const onSubmit = async (data: PuzzleFormData) => {
    if (!convexUser?._id) {
      toast.error("User not found");
      return;
    }

    try {
      // Create the puzzle with both product and instance
      const result = await createPuzzle({
        // Product fields
        title: data.title,
        description: data.description,
        brand: data.brand,
        pieceCount: data.pieceCount,
        difficulty: data.difficulty,
        category: data.category as Id<"adminCategories">,
        tags: data.tags || [],
        images: data.images || [],

        // Instance fields
        ownerId: convexUser._id as Id<"users">,
        condition: data.condition,
        isAvailable: data.isAvailable,
        acquisitionDate: data.acquisitionDate,
        notes: data.notes,
      });

      toast.success("Puzzle created successfully!");
      onSuccess?.();
    } catch (error) {
      console.error("Failed to create puzzle:", error);
      toast.error("Failed to create puzzle");
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {/* Basic Information */}
        <div className="space-y-6">
          <PuzzleFormBasicInfo
            form={form}
            categories={categories}
            onSuggestionUsed={handleSuggestionUsed}
          />
        </div>

        {/* Status Information - only show when title is entered and interacted with */}
        {shouldShowOtherSections && (
          <div className="space-y-6 animate-in slide-in-from-top-2 duration-300">
            <PuzzleFormStatusInfo form={form} />
          </div>
        )}

        {/* Completion Tracking - only show when title is entered and interacted with */}
        {shouldShowOtherSections && (
          <div className="space-y-6 animate-in slide-in-from-top-2 duration-300">
            <PuzzleFormCompletions form={form} />
          </div>
        )}

        {/* Form Actions - only show when title is entered and interacted with */}
        {showActions && shouldShowOtherSections && (
          <div className="animate-in slide-in-from-top-2 duration-300">
            <PuzzleFormActions />
          </div>
        )}
      </form>
    </Form>
  );
}

// Compound form components
PuzzleForm.Root = PuzzleFormRoot;
PuzzleForm.Form = PuzzleFormForm;
PuzzleForm.Title = PuzzleFormTitle;
PuzzleForm.Actions = PuzzleFormActions;

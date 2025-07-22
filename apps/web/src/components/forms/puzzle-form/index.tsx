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

interface PuzzleFormProps {
  id: string;
  onSuccess?: () => void;
  onCancel?: () => void;
  defaultValues?: Partial<PuzzleFormData>;
  showActions?: boolean;
}

export function PuzzleForm({
  id,
  onSuccess,
  onCancel,
  defaultValues = puzzleFormDefaultValues,
  showActions = true,
}: PuzzleFormProps) {
  const { user } = useUser();
  const createPuzzle = useMutation(api.puzzles.createPuzzle);

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
    (hasInteractedWithTitle && titleValue && titleValue.trim().length > 0);

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
      // Create the puzzle with completions
      const puzzleId = await createPuzzle({
        ...data,
        ownerId: convexUser._id as Id<"users">,
        category: data.category as Id<"adminCategories">,
        completions: data.completions?.map((completion) => ({
          completedDate: completion.completedDate,
          completionTimeMinutes: completion.completionTimeMinutes,
          notes: completion.notes,
        })),
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
            onTitleInteraction={handleTitleInteraction}
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
            <PuzzleFormActions onCancel={onCancel} />
          </div>
        )}
      </form>
    </Form>
  );
}

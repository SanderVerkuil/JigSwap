"use client";

import { useUser } from "@clerk/nextjs";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@jigswap/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useForm } from "react-hook-form";

import { Form } from "@/components/ui/form";
import { toast } from "sonner";

import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { PuzzleFormActions } from "./puzzle-form-actions";
import { PuzzleFormBasicInfo } from "./puzzle-form-basic-info";
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

  const onSubmit = async (data: PuzzleFormData) => {
    if (!convexUser?._id) {
      toast.error("User not found");
      return;
    }

    try {
      await createPuzzle({
        ...data,
        ownerId: convexUser._id as Id<"users">,
        category: data.category as Id<"adminCategories">,
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
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <PuzzleFormBasicInfo form={form} categories={categories} />

        <PuzzleFormStatusInfo form={form} />

        {showActions && (
          <PuzzleFormActions
            onCancel={onCancel}
            isSubmitting={form.formState.isSubmitting}
          />
        )}
      </form>
    </Form>
  );
}

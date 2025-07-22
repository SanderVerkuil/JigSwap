"use client";

import { useUser } from "@clerk/nextjs";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@jigswap/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useForm } from "react-hook-form";

import { toast } from "sonner";

import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { PuzzleFormProvider } from "./puzzle-form-context";
import {
  puzzleFormDefaultValues,
  puzzleFormSchema,
  type PuzzleFormData,
} from "./puzzle-form-schema";

interface PuzzleFormRootProps {
  children: React.ReactNode;
  onSuccess?: () => void;
  onCancel?: () => void;
  defaultValues?: Partial<PuzzleFormData>;
}

export function PuzzleFormRoot({
  children,
  onSuccess,
  onCancel,
  defaultValues = puzzleFormDefaultValues,
}: PuzzleFormRootProps) {
  const { user } = useUser();
  const createPuzzle = useMutation(api.puzzles.createPuzzle);

  // Get the current user from the database
  const convexUser = useQuery(
    api.users.getUserByClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

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
      if ("newTag" in data) {
        delete data.newTag;
      }
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
    <PuzzleFormProvider
      form={form}
      onSubmit={onSubmit}
      onSuccess={onSuccess}
      onCancel={onCancel}
    >
      {children}
    </PuzzleFormProvider>
  );
}

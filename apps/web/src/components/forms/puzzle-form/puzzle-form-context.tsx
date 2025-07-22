"use client";

import { createContext, useContext, useId, useState } from "react";
import { UseFormReturn } from "react-hook-form";

import { type PuzzleFormData } from "./puzzle-form-schema";

interface PuzzleFormContextValue {
  id: string;
  form: UseFormReturn<PuzzleFormData>;
  hasInteractedWithTitle: boolean;
  hasUsedSuggestion: boolean;
  shouldShowOtherSections: boolean;
  onTitleInteraction: () => void;
  onSuggestionUsed: () => void;
  onSubmit: (data: PuzzleFormData) => Promise<void>;
  onSuccess?: () => void;
  onCancel?: () => void;
}

const PuzzleFormContext = createContext<PuzzleFormContextValue | null>(null);

export function usePuzzleForm() {
  const context = useContext(PuzzleFormContext);
  if (!context) {
    throw new Error("usePuzzleForm must be used within a PuzzleForm.Root");
  }
  return context;
}

interface PuzzleFormProviderProps {
  children: React.ReactNode;
  form: UseFormReturn<PuzzleFormData>;
  onSubmit: (data: PuzzleFormData) => Promise<void>;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function PuzzleFormProvider({
  children,
  form,
  onSubmit,
  onSuccess,
  onCancel,
}: PuzzleFormProviderProps) {
  const id = useId();
  const [hasInteractedWithTitle, setHasInteractedWithTitle] = useState(false);
  const [hasUsedSuggestion, setHasUsedSuggestion] = useState(false);

  // Watch the title field and track interaction states
  const titleValue = form.watch("title");

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

  const value: PuzzleFormContextValue = {
    id,
    form,
    hasInteractedWithTitle,
    hasUsedSuggestion,
    shouldShowOtherSections,
    onTitleInteraction: handleTitleInteraction,
    onSuggestionUsed: handleSuggestionUsed,
    onSubmit,
    onSuccess,
    onCancel,
  };

  return (
    <PuzzleFormContext.Provider value={value}>
      {children}
    </PuzzleFormContext.Provider>
  );
}

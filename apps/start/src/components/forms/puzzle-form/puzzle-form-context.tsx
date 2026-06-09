import { createContext, useContext } from "react";
import { SubmitHandler, UseFormReturn } from "react-hook-form";
import { PuzzleFormData } from "./puzzle-form-schema";

interface PuzzleFormContextValue {
  form: UseFormReturn<PuzzleFormData>;
  formId: string;
  isPending: boolean;
  onSubmit: SubmitHandler<PuzzleFormData>;
  onCancel?: () => void;
}

const PuzzleFormContext = createContext<PuzzleFormContextValue | null>(null);

export const usePuzzleFormContext = () => {
  const context = useContext(PuzzleFormContext);
  if (!context) {
    throw new Error(
      "usePuzzleFormContext must be used within PuzzleFormProvider",
    );
  }
  return context;
};

export const PuzzleFormProvider = PuzzleFormContext.Provider;

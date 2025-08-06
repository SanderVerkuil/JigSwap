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

const PuzzleProductFormContext = createContext<PuzzleFormContextValue | null>(
  null,
);

export const usePuzzleProductFormContext = () => {
  const context = useContext(PuzzleProductFormContext);
  if (!context) {
    throw new Error(
      "usePuzzleProductFormContext must be used within PuzzleProductFormProvider",
    );
  }
  return context;
};

export const PuzzleProductFormProvider = PuzzleProductFormContext.Provider;

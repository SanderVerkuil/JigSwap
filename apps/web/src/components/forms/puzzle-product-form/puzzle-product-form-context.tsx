import { createContext, useContext } from "react";
import { SubmitHandler, UseFormReturn } from "react-hook-form";
import { PuzzleProductFormData } from "./puzzle-product-form-schema";

interface PuzzleProductFormContextValue {
  form: UseFormReturn<PuzzleProductFormData>;
  formId: string;
  isPending: boolean;
  onSubmit: SubmitHandler<PuzzleProductFormData>;
  onCancel?: () => void;
}

const PuzzleProductFormContext =
  createContext<PuzzleProductFormContextValue | null>(null);

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

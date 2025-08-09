import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { PuzzleFormProvider } from "./puzzle-form-context";
import { PuzzleFormData, puzzleFormSchema } from "./puzzle-form-schema";

interface PuzzleFormRootProps {
  onSubmit: (data: PuzzleFormData) => void | Promise<void>;
  onCancel?: () => void;
  pending?: boolean;
  defaultValues?: PuzzleFormData;
  children: React.ReactNode;
}

export const PuzzleFormRoot = ({
  onSubmit,
  onCancel,
  pending = false,
  defaultValues,
  children,
}: PuzzleFormRootProps) => {
  const form = useForm<PuzzleFormData>({
    resolver: zodResolver(puzzleFormSchema),
    defaultValues:
      defaultValues !== undefined
        ? defaultValues
        : {
            title: "",
            description: "",
            brand: "",
            artist: "",
            series: "",
            pieceCount: undefined,
            difficulty: undefined,
            category: undefined,
            tags: [],
            ean: "",
            upc: "",
            modelNumber: "",
            dimensions: undefined,
            shape: undefined,
          },
  });

  const formId = useId();

  return (
    <PuzzleFormProvider
      value={{ form, formId, isPending: pending, onSubmit, onCancel }}
    >
      {children}
    </PuzzleFormProvider>
  );
};

import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { PuzzleProductFormProvider } from "./puzzle-product-form-context";
import {
  PuzzleProductFormData,
  puzzleProductFormSchema,
} from "./puzzle-product-form-schema";

interface PuzzleProductFormRootProps {
  onSubmit: (data: PuzzleProductFormData) => void | Promise<void>;
  onCancel?: () => void;
  pending?: boolean;
  defaultValues?: PuzzleProductFormData;
  children: React.ReactNode;
}

export const PuzzleProductFormRoot = ({
  onSubmit,
  onCancel,
  pending = false,
  defaultValues,
  children,
}: PuzzleProductFormRootProps) => {
  const form = useForm<PuzzleProductFormData>({
    resolver: zodResolver(puzzleProductFormSchema),
    defaultValues:
      defaultValues !== undefined
        ? defaultValues
        : {
            title: "",
            description: "",
            brand: "",
            pieceCount: undefined,
            difficulty: undefined,
            category: undefined,
            tags: [],
          },
  });

  const formId = useId();

  return (
    <PuzzleProductFormProvider
      value={{ form, formId, isPending: pending, onSubmit, onCancel }}
    >
      {children}
    </PuzzleProductFormProvider>
  );
};

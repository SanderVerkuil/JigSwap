"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { PuzzleForm } from "./index";
import { type PuzzleFormData } from "./puzzle-form-schema";

interface PuzzleFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  defaultValues?: Partial<PuzzleFormData>;
}

export function PuzzleFormModal({
  open,
  onOpenChange,
  onSuccess,
  defaultValues,
}: PuzzleFormModalProps) {
  const handleSuccess = () => {
    onOpenChange(false);
    onSuccess?.();
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add New Puzzle</SheetTitle>
          <SheetDescription>
            Add a new puzzle to your collection
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6">
          <PuzzleForm
            id="modal-puzzle-form"
            onSuccess={handleSuccess}
            onCancel={handleCancel}
            defaultValues={defaultValues}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

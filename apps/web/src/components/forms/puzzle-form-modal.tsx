"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PuzzleForm } from "./puzzle-form";

interface PuzzleFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function PuzzleFormModal({
  open,
  onOpenChange,
  onSuccess,
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
      <SheetContent
        side="right"
        className="w-[800px] sm:w-[900px] overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>Add New Puzzle</SheetTitle>
        </SheetHeader>
        <div className="mt-6">
          <PuzzleForm
            id="modal-puzzle-form"
            onSuccess={handleSuccess}
            onCancel={handleCancel}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

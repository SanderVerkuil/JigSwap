"use client";

import { Button } from "@/components/ui/button";
import { usePuzzleForm } from "./puzzle-form-context";

export function PuzzleFormActions() {
  const { id, onCancel, form } = usePuzzleForm();
  const isSubmitting = form.formState.isSubmitting;

  return (
    <div className="flex items-center justify-end space-x-2 pt-6">
      {onCancel && (
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      )}
      <Button type="submit" form={id} disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : "Save Puzzle"}
      </Button>
    </div>
  );
}

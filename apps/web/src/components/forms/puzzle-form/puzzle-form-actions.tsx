"use client";

import { Button } from "@/components/ui/button";

interface PuzzleFormActionsProps {
  onCancel?: () => void;
  isSubmitting?: boolean;
}

export function PuzzleFormActions({
  onCancel,
  isSubmitting,
}: PuzzleFormActionsProps) {
  return (
    <div className="flex items-center justify-end space-x-2 pt-6">
      {onCancel && (
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : "Save Puzzle"}
      </Button>
    </div>
  );
}

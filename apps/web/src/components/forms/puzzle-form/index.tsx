import { PuzzleFormActions } from "./puzzle-form-actions";
import { PuzzleFormContent } from "./puzzle-form-content";
import { PuzzleFormRoot } from "./puzzle-form-root";
import { PuzzleFormTitle } from "./puzzle-form-title";

// Compound component with all parts
export const PuzzleForm = Object.assign(PuzzleFormRoot, {
  Root: PuzzleFormRoot,
  Content: PuzzleFormContent,
  Actions: PuzzleFormActions,
  Title: PuzzleFormTitle,
});

// Default export for simple usage
export default PuzzleForm;

// Export types
export type { PuzzleFormData } from "./puzzle-form-schema";

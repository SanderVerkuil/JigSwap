import { PuzzleProductFormActions } from "./puzzle-product-form-actions";
import { PuzzleProductFormContent } from "./puzzle-product-form-content";
import { PuzzleProductFormRoot } from "./puzzle-product-form-root";
import { PuzzleProductFormTitle } from "./puzzle-product-form-title";

// Compound component with all parts
export const PuzzleProductForm = Object.assign(PuzzleProductFormRoot, {
  Root: PuzzleProductFormRoot,
  Content: PuzzleProductFormContent,
  Actions: PuzzleProductFormActions,
  Title: PuzzleProductFormTitle,
});

// Default export for simple usage
export default PuzzleProductForm;

// Export types
export type { PuzzleProductFormData } from "./puzzle-product-form-schema";

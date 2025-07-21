# Puzzle Form Components

This directory contains a compound React component for creating and editing puzzles, organized according to the workspace component management rules.

## Component Structure

### Main Component: `index.tsx`
The main `PuzzleForm` component that orchestrates the entire form. It's designed as a compound component that can be used in both dialogs and pages.

**Props:**
- `id: string` - Unique identifier for the form
- `onSuccess?: () => void` - Callback when form is successfully submitted
- `onCancel?: () => void` - Callback when form is cancelled
- `defaultValues?: Partial<PuzzleFormData>` - Default values for the form fields
- `showActions?: boolean` - Whether to show action buttons (default: true)

**Usage:**
```tsx
import { PuzzleForm } from "@/components/forms";

<PuzzleForm
  id="add-puzzle-form"
  onSuccess={() => router.push("/puzzles")}
  onCancel={() => router.back()}
  showActions={false} // For use in dialogs
/>
```

### Sub-Components

#### `puzzle-form-basic-info.tsx`
Handles the basic puzzle information:
- Title and description
- Brand and category
- Piece count (with custom input support)
- Difficulty and condition
- Tags management

#### `puzzle-form-status-info.tsx`
Handles completion and acquisition details:
- Completion status toggle
- Completion date (conditional)
- Acquisition date
- Notes

#### `puzzle-form-actions.tsx`
Handles form submission and cancellation:
- Submit button with loading state
- Cancel button (optional)

#### `puzzle-form-modal.tsx`
A modal wrapper for the form using a Sheet component.

**Props:**
- `open: boolean` - Controls modal visibility
- `onOpenChange: (open: boolean) => void` - Callback when modal state changes
- `onSuccess?: () => void` - Callback when form is successfully submitted
- `defaultValues?: Partial<PuzzleFormData>` - Default values for the form

**Usage:**
```tsx
import { PuzzleFormModal } from "@/components/forms";

const [open, setOpen] = useState(false);

<PuzzleFormModal
  open={open}
  onOpenChange={setOpen}
  onSuccess={() => {
    setOpen(false);
    // Refresh data or navigate
  }}
/>
```

## Schema

The form uses a Zod schema for validation:

```tsx
import { puzzleFormSchema, type PuzzleFormData } from "@/components/forms";

// Form data type
type PuzzleFormData = {
  title: string;
  description?: string;
  brand?: string;
  pieceCount: number;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  condition: "excellent" | "good" | "fair" | "poor";
  category?: string;
  tags?: string[];
  newTag?: string; // For tag input
  images: string[];
  isCompleted: boolean;
  completedDate?: number;
  acquisitionDate?: number;
  notes?: string;
};
```

## Features

- **Compound Components**: Built with compound React components for flexibility
- **Form Validation**: Uses Zod schema validation with react-hook-form
- **Reusable**: Can be used in both pages and dialogs
- **Modular**: Each section is a separate component for easy maintenance
- **Type Safe**: Full TypeScript support with proper typing
- **Accessible**: Built with accessibility in mind using proper form controls

## Organization Rules

This component follows the workspace component organization rules:

1. **Forms should be their own components** ✅
2. **Forms should be compound components** ✅
3. **Component names should be `/<component-name>/index.tsx`** ✅
4. **Sub-components in `<component-name>/sub-component.tsx`** ✅

The structure allows for easy reuse in both dialogs and pages while maintaining clean separation of concerns. 
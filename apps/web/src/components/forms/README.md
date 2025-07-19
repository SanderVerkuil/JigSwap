# Puzzle Form Components

This directory contains reusable form components for adding and editing puzzles.

## Components

### PuzzleForm

A compound React component for creating and editing puzzles. Uses react-hook-form with Zod validation.

**Props:**
- `id: string` - Unique identifier for the form
- `onSuccess?: () => void` - Callback when form is successfully submitted
- `onCancel?: () => void` - Callback when form is cancelled
- `defaultValues?: Partial<PuzzleFormData>` - Default values for the form fields

**Usage:**
```tsx
import { PuzzleForm } from "@/components/forms";

<PuzzleForm
  id="add-puzzle-form"
  onSuccess={() => router.push("/puzzles")}
  onCancel={() => router.back()}
/>
```

### PuzzleFormModal

A modal wrapper for the PuzzleForm component using a Sheet.

**Props:**
- `open: boolean` - Controls modal visibility
- `onOpenChange: (open: boolean) => void` - Callback when modal state changes
- `onSuccess?: () => void` - Callback when form is successfully submitted

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
  images: string[];
  isCompleted: boolean;
  completedDate?: number;
  acquisitionDate?: number;
  notes?: string;
};
```

## Features

- **Form Validation**: Uses Zod schema validation with react-hook-form
- **Compound Components**: Built with compound React components for flexibility
- **Reusable**: Can be used in pages, modals, or any other context
- **Type Safe**: Full TypeScript support with proper types
- **Accessible**: Built with accessibility in mind using Radix UI primitives
- **Responsive**: Works well on mobile and desktop
- **Image Upload**: Supports multiple image uploads (TODO: implement actual upload logic)
- **Tag Management**: Dynamic tag addition and removal
- **Condition Selection**: Dropdown for puzzle condition
- **Difficulty Selection**: Dropdown for puzzle difficulty

## TODO

- [ ] Implement actual image upload functionality
- [ ] Add image preview/management
- [ ] Add form field for acquisition date
- [ ] Add form field for completion date
- [ ] Add validation for image file types and sizes
- [ ] Add loading states for form submission
- [ ] Add error handling for network failures 
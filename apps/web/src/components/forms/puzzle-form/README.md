# Puzzle Form Components

This directory contains the puzzle form components organized as compound components for flexibility and reusability.

## Components

### `index.tsx` - Main Puzzle Form
The main puzzle form component that orchestrates all sub-components.

**Props:**
- `id: string` - Unique form identifier
- `onSuccess?: () => void` - Callback when form is successfully submitted
- `onCancel?: () => void` - Callback when form is cancelled
- `defaultValues?: Partial<PuzzleFormData>` - Initial form values
- `showActions?: boolean` - Whether to show form actions (default: true)

**Usage:**
```tsx
<PuzzleForm
  id="add-puzzle-form"
  onSuccess={() => router.push("/puzzles")}
  onCancel={() => router.back()}
/>
```

### `puzzle-form-suggestions.tsx` - Puzzle Suggestions
Provides puzzle suggestions from existing puzzles in the database to help users quickly fill in details.

**Features:**
- Search existing puzzles by title, brand, or description
- Auto-fill form fields when a suggestion is selected
- Real-time search with debouncing
- Internationalized text content

### `puzzle-form-basic-info.tsx` - Basic Information
Handles the core puzzle information (title, brand, piece count, difficulty, etc.).

**Fields:**
- Title (required)
- Description (optional)
- Brand (optional)
- Piece count (required)
- Difficulty (optional)
- Condition (required)
- Category (optional)
- Tags (optional)
- Images (required)

### `puzzle-form-completions.tsx` - Completion Tracking
Allows users to track multiple puzzle completions with detailed timing and notes.

**Features:**
- Multiple completion entries
- Optional time tracking (in minutes)
- Completion notes for each entry
- Add/remove completion entries
- Internationalized text content

**Fields per completion:**
- Completion date
- Time spent (optional, in minutes)
- Notes (optional)

### `puzzle-form-status-info.tsx` - Status Information
Handles acquisition date and general notes.

**Fields:**
- Acquisition date (optional)
- General notes (optional)

### `puzzle-form-actions.tsx` - Form Actions
Provides form submission and cancellation buttons.

**Actions:**
- Save/Cancel buttons
- Loading states
- Internationalized text

### `puzzle-form-modal.tsx` - Modal Wrapper
Provides a modal wrapper for the puzzle form.

**Usage:**
```tsx
<PuzzleFormModal
  open={open}
  onOpenChange={setOpen}
  onSuccess={() => setOpen(false)}
/>
```

## Schema

### `puzzle-form-schema.ts`
Defines the form validation schema using Zod.

**Key additions:**
- `completions: CompletionEntry[]` - Array of completion entries
- `CompletionEntry` interface with id, completedDate, completionTimeMinutes, and notes

## Internationalization

All text content is internationalized using `useTranslations` from `next-intl`.

**Translation keys:**
- `puzzles.suggestions.*` - Puzzle suggestions
- `puzzles.completions.*` - Completion tracking
- `puzzles.statusInformation*` - Status information
- `puzzles.basicInformation*` - Basic information

## Form Flow

1. **Suggestions** - Users can search for existing puzzles to auto-fill details
2. **Basic Information** - Core puzzle details
3. **Completions** - Track multiple completions with timing
4. **Status Information** - Acquisition date and notes
5. **Actions** - Save or cancel the form

## Backend Integration

The form creates puzzles using the `createPuzzle` mutation. Completion records are planned to be created using the existing `completions` table structure.

**TODO:**
- Implement completion record creation in the backend
- Add bulk completion creation mutation
- Update puzzle creation to handle multiple completions

## Usage Examples

### In a page:
```tsx
<PuzzleForm
  id="add-puzzle-form"
  onSuccess={() => router.push("/puzzles")}
  onCancel={() => router.back()}
/>
```

### In a modal:
```tsx
<PuzzleFormModal
  open={open}
  onOpenChange={setOpen}
  onSuccess={() => setOpen(false)}
/>
```

### With default values:
```tsx
<PuzzleForm
  id="edit-puzzle-form"
  defaultValues={{
    title: "My Puzzle",
    pieceCount: 1000,
    condition: "good",
    isCompleted: true,
    completions: [
      {
        id: "1",
        completedDate: Date.now(),
        completionTimeMinutes: 120,
        notes: "Completed with family"
      }
    ]
  }}
  onSuccess={handleSuccess}
/>
```

## Component Organization

Following the established patterns:
- Main component: `index.tsx`
- Sub-components: `puzzle-form-<section>.tsx`
- Schema: `puzzle-form-schema.ts`
- Modal wrapper: `puzzle-form-modal.tsx`
- Actions: `puzzle-form-actions.tsx`

All components are compound components that can be used independently or together in the main form. 
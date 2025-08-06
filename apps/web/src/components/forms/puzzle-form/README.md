# Puzzle Product Form

A compound React component for creating and editing puzzle products. Uses react-hook-form with Zod validation.

## Features

- **Form Validation**: Uses Zod schema validation with react-hook-form
- **Compound Components**: Built with compound React components for flexibility
- **Internationalization**: All text content is internationalized using next-intl
- **Type Safety**: Full TypeScript support with proper interfaces
- **shadcn/ui**: Uses existing shadcn/ui components

## Usage

### Simple Usage

```tsx
import { PuzzleProductForm } from "@/components/forms/puzzle-form";

<PuzzleProductForm
  onSubmit={handleSubmit}
  onCancel={handleCancel}
  pending={isPending}
/>;
```

### Compound Component Usage

```tsx
import { PuzzleProductForm } from "@/components/forms/puzzle-form";

<PuzzleProductForm.Root
  onSubmit={handleSubmit}
  onCancel={handleCancel}
  pending={isPending}
>
  <PuzzleProductForm.Title>Create New Puzzle Product</PuzzleProductForm.Title>
  <PuzzleProductForm.Content />
  <PuzzleProductForm.Actions onCancel={handleCancel} />
</PuzzleProductForm.Root>;
```

### Dialog Usage

```tsx
import { Dialog } from "@/components/ui/dialog";
import { PuzzleProductForm } from "@/components/forms/puzzle-form";

<Dialog open={open} onOpenChange={setOpen}>
  <PuzzleProductForm.Root
    onSubmit={handleSubmit}
    onCancel={() => setOpen(false)}
    pending={isPending}
  >
    <Dialog.Title>
      <PuzzleProductForm.Title />
    </Dialog.Title>
    <Dialog.Content>
      <PuzzleProductForm.Content />
    </Dialog.Content>
    <Dialog.Footer>
      <PuzzleProductForm.Actions onCancel={() => setOpen(false)} />
    </Dialog.Footer>
  </PuzzleProductForm.Root>
</Dialog>;
```

### Card Usage

```tsx
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { PuzzleProductForm } from "@/components/forms/puzzle-form";

<PuzzleProductForm.Root
  onSubmit={handleSubmit}
  onCancel={handleCancel}
  pending={isPending}
>
  <Card>
    <CardHeader>
      <PuzzleProductForm.Title />
    </CardHeader>
    <CardContent>
      <PuzzleProductForm.Content />
    </CardContent>
    <CardFooter>
      <PuzzleProductForm.Actions onCancel={handleCancel} />
    </CardFooter>
  </Card>
</PuzzleProductForm.Root>;
```

## Props

### PuzzleProductForm.Root

- `onSubmit: (data: PuzzleProductFormData) => void | Promise<void>` - Callback when form is submitted
- `onCancel?: () => void` - Callback when form is cancelled
- `pending?: boolean` - Whether the form is in a pending state
- `defaultValues?: Partial<PuzzleProductFormData>` - Default values for form fields
- `children: React.ReactNode` - Form content

### PuzzleProductForm.Actions

- `onCancel?: () => void` - Callback for cancel button

### PuzzleProductForm.Title

- `children?: React.ReactNode` - Custom title content

## Form Data

```tsx
interface PuzzleProductFormData {
  title: string;
  description?: string;
  brand?: string;
  pieceCount: number;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  category?: string;
  tags: string[];
  images: string[];
}
```

## Validation

The form uses Zod validation with the following rules:

- **Title**: Required, 3-100 characters
- **Description**: Optional, max 500 characters
- **Brand**: Optional, max 50 characters
- **Piece Count**: Required, 1-50,000, integer
- **Difficulty**: Optional, enum of "easy", "medium", "hard", "expert"
- **Category**: Optional string
- **Tags**: Array of strings, comma-separated input
- **Images**: Array of strings

## Internationalization

All text content is internationalized using next-intl. Translation keys follow the pattern:
`forms.puzzle-form.<field-name>.<property>`

Example translation structure:

```json
{
  "forms": {
    "puzzle-form": {
      "title": "Puzzle Product",
      "title": {
        "label": "Title",
        "placeholder": "Enter puzzle title"
      },
      "actions": {
        "submit": "Save Product",
        "submitting": "Saving...",
        "cancel": "Cancel"
      }
    }
  }
}
```

## API Integration

The form is designed to work with the Convex backend API:

- **Create**: `api.puzzles.createPuzzleProduct`
- **Update**: `api.puzzles.updatePuzzleProduct`

Example API call:

```tsx
const createProduct = useMutation(api.puzzles.createPuzzleProduct);

const handleSubmit = async (data: PuzzleProductFormData) => {
  await createProduct({
    title: data.title,
    description: data.description,
    brand: data.brand,
    pieceCount: data.pieceCount,
    difficulty: data.difficulty,
    category: data.category,
    tags: data.tags,
    images: data.images,
  });
};
```

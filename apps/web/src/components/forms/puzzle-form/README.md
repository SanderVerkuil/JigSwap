# Puzzle Form Component

A stepper-based form component for creating puzzle instances with compound components architecture.

## Features

- **Stepper Interface**: Two-step process for creating puzzles
- **Product Search**: Search existing puzzles or create new ones
- **Instance Details**: Configure your specific puzzle copy
- **Compound Components**: Modular architecture for easy customization
- **Form Validation**: Comprehensive validation using Zod
- **User-Friendly UX**: Clear navigation and feedback
- **Flexible Composition**: Can be used in cards, dialogs, or any container

## Usage Patterns

### 1. Basic Usage (Legacy)

```tsx
import { PuzzleForm } from "@/components/forms/puzzle-form";

function MyPage() {
  const handleSuccess = (data: { productId: string; instanceId: string }) => {
    console.log("Puzzle created:", data);
  };

  return (
    <PuzzleForm
      onSuccess={handleSuccess}
      onCancel={() => router.back()}
    />
  );
}
```

### 2. Compound Components in Card

```tsx
import { PuzzleForm } from "@/components/forms/puzzle-form";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";

function MyPage() {
  return (
    <PuzzleForm.Root onSuccess={handleSuccess} onCancel={handleCancel}>
      <Card>
        <CardHeader>
          <PuzzleForm.Title />
        </CardHeader>
        <CardContent>
          <PuzzleForm.Form />
        </CardContent>
        <CardFooter>
          <PuzzleForm.Actions />
        </CardFooter>
      </Card>
    </PuzzleForm.Root>
  );
}
```

### 3. Compound Components in Dialog

```tsx
import { PuzzleForm } from "@/components/forms/puzzle-form";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";

function MyDialog() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>Add Puzzle</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <PuzzleForm.Root onSuccess={handleSuccess} onCancel={() => setIsOpen(false)}>
          <DialogHeader>
            <PuzzleForm.Title />
          </DialogHeader>
          <div className="py-4">
            <PuzzleForm.Form />
          </div>
          <DialogFooter>
            <PuzzleForm.Actions />
          </DialogFooter>
        </PuzzleForm.Root>
      </DialogContent>
    </Dialog>
  );
}
```

### 4. Custom Layout

```tsx
function CustomLayout() {
  return (
    <PuzzleForm.Root onSuccess={handleSuccess} onCancel={handleCancel}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <PuzzleForm.Title />
          <PuzzleForm.Form />
        </div>
        <div className="bg-muted p-4 rounded-lg">
          <h3>Preview</h3>
          {/* Custom preview content */}
        </div>
      </div>
      <div className="mt-6">
        <PuzzleForm.Actions />
      </div>
    </PuzzleForm.Root>
  );
}
```

## Compound Components

The form uses compound components for maximum flexibility:

### `PuzzleForm.Root`
The root component that provides context and manages form state.

**Props:**
- `onSuccess?: (data: { productId: string; instanceId: string }) => void`
- `onCancel?: () => void`
- `defaultValues?: Partial<PuzzleFormData>`
- `children: React.ReactNode`

### `PuzzleForm.Title`
Displays the form title and description.

### `PuzzleForm.Form`
Renders the stepper and form content (search/create + instance details).

### `PuzzleForm.Actions`
Renders the navigation buttons (Back, Next, Cancel, Submit).

## Form Steps

### Step 1: Find Puzzle
- Search for existing puzzles by title, brand, or description
- View suggestions with piece count and difficulty
- Option to create a new puzzle if none exists

### Step 2: Your Copy Details
- Set condition (excellent, good, fair, poor)
- Configure availability for swapping
- Add acquisition date and personal notes

## Form Schema

```typescript
interface PuzzleFormData {
  // Product fields (for creating new products)
  title: string;
  description?: string;
  brand?: string;
  pieceCount: number;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  category?: string;
  tags?: string[];
  images: string[];
  
  // Instance fields
  productId?: string | null;
  ownerId?: string; // Set automatically from current user
  condition: "excellent" | "good" | "fair" | "poor";
  isAvailable: boolean;
  acquisitionDate?: number;
  notes?: string;
}
```

## Context and State Management

The form uses React Context to share state between components:

```typescript
interface PuzzleFormContextValue {
  currentStep: number;
  selectedProduct: PuzzleProduct | null;
  isCreatingProduct: boolean;
  isSubmitting: boolean;
  isValid: boolean;
  canProceed: boolean;
  handleProductSelected: (product: PuzzleProduct) => void;
  handleCreateNew: () => void;
  handleBackToSearch: () => void;
  handleStepClick: (step: number) => void;
  handleNext: () => void;
  handleBack: () => void;
  handleSubmit: () => void;
  handleCancel: () => void;
}
```

## Backend Integration

The form integrates with Convex backend:

- Uses `createPuzzleProduct` mutation for new products
- Uses `createPuzzleInstance` mutation for instances
- Automatically handles user authentication
- Provides real-time search suggestions

## Styling

The form uses Tailwind CSS classes and follows the design system:

- Responsive design
- Dark mode support
- Accessible form controls
- Loading states and error handling

## Dependencies

- `react-hook-form` - Form state management
- `zod` - Schema validation
- `convex` - Backend integration
- `@clerk/nextjs` - User authentication
- `lucide-react` - Icons
- `sonner` - Toast notifications

## Examples

See the following files for complete examples:
- `apps/web/src/app/(dashboard)/puzzles/add/page.tsx` - Card layout example
- `apps/web/src/components/forms/puzzle-form/dialog-example.tsx` - Dialog example 
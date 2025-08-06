# Details Components

This directory contains reusable detail view components for displaying puzzle and collection information, organized according to the workspace component management rules.

## Component Structure

### Puzzle Detail: `puzzle-detail/index.tsx`

The main `PuzzleDetail` component that displays comprehensive puzzle information.

**Props:**

- `puzzleId: Id<"puzzles">` - The puzzle ID to display
- `showActions?: boolean` - Whether to show action buttons (default: true)
- `onEdit?: (puzzleId: Id<"puzzles">) => void` - Edit callback
- `onView?: (puzzleId: Id<"puzzles">) => void` - View callback
- `onDelete?: (puzzleId: Id<"puzzles">) => void` - Delete callback
- `onRequestExchange?: (puzzleId: Id<"puzzles">) => void` - Exchange request callback
- `onMessage?: (puzzleId: Id<"puzzles">) => void` - Message callback
- `onFavorite?: (puzzleId: Id<"puzzles">) => void` - Favorite callback
- `showOwner?: boolean` - Whether to show owner information (default: false)
- `className?: string` - Additional CSS classes

**Usage:**

```tsx
import { PuzzleDetail } from "@/components/details";

<PuzzleDetail
  puzzleId={puzzleId}
  showActions={true}
  onEdit={(id) => router.push(`/puzzles/${id}/edit`)}
  onView={(id) => router.push(`/puzzles/${id}`)}
  showOwner={true}
/>;
```

### Collection Detail: `collection-detail/index.tsx`

The main `CollectionDetail` component that displays collection information with its puzzles.

**Props:**

- `collectionId: Id<"collections">` - The collection ID to display
- `showActions?: boolean` - Whether to show action buttons (default: true)
- `onEdit?: (collectionId: Id<"collections">) => void` - Edit callback
- `onAddPuzzles?: (collectionId: Id<"collections">) => void` - Add puzzles callback
- `className?: string` - Additional CSS classes

**Usage:**

```tsx
import { CollectionDetail } from "@/components/details";

<CollectionDetail
  collectionId={collectionId}
  showActions={true}
  onEdit={(id) => router.push(`/collections/${id}/edit`)}
  onAddPuzzles={(id) => router.push(`/collections/${id}/add-puzzles`)}
/>;
```

## Sub-Components

### Puzzle Detail Sub-Components

#### `puzzle-detail-header.tsx`

Displays the puzzle title, brand, and status badges (availability, completion).

#### `puzzle-detail-info.tsx`

Shows detailed puzzle information:

- Basic details (piece count, difficulty, condition, category)
- Tags
- Owner information (if enabled)
- Timeline (acquisition, completion, added dates)
- Notes

#### `puzzle-detail-actions.tsx`

Handles all action buttons:

- Primary actions (request trade, edit, view)
- Secondary actions (favorite, message, delete)

### Collection Detail Sub-Components

#### `collection-detail-header.tsx`

Displays the collection name, icon, color, and action buttons.

#### `collection-detail-actions.tsx`

Handles collection action buttons (edit, add puzzles).

## Features

- **Compound Components**: Built with compound React components for flexibility
- **Reusable**: Can be used in both pages and dialogs
- **Modular**: Each section is a separate component for easy maintenance
- **Type Safe**: Full TypeScript support with proper typing
- **Responsive**: Built with responsive design in mind
- **Accessible**: Built with accessibility in mind

## Organization Rules

This component follows the workspace component organization rules:

1. **Details components should be their own components** ✅
2. **Details components should be compound components** ✅
3. **Component names should be `/<component-name>/index.tsx`** ✅
4. **Sub-components in `<component-name>/sub-component.tsx`** ✅

The structure allows for easy reuse in both pages and dialogs while maintaining clean separation of concerns.

## Data Fetching

Both components use Convex queries to fetch their data:

- `PuzzleDetail` uses `api.puzzles.getPuzzleWithCollectionStatus`
- `CollectionDetail` uses `api.collections.getCollectionById`

The components handle loading states and error cases gracefully.

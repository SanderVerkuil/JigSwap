# Puzzle Products Page Components

This directory contains the components for the puzzle products page, which allows users to browse, filter, and view puzzle products with infinite scroll functionality.

## Component Architecture

### Main Components

#### `puzzle-products-client.tsx`

The main client component that orchestrates the entire puzzle products page. It handles:

- Infinite scroll pagination using `usePaginatedQuery`
- Filter state management
- View mode switching (grid/list)
- Search functionality
- Integration with all sub-components

**Key Features:**

- Infinite scroll with intersection observer
- Real-time filtering
- Responsive design
- Loading states

#### `puzzle-product-card.tsx`

Individual product card component that displays:

- Product image (with fallback)
- Title and brand
- Piece count and difficulty
- Tags
- Action buttons (View Details, Add Puzzle)

**Props:**

- `product`: Puzzle product data
- `onAddPuzzle`: Callback for adding puzzle
- `onViewDetails`: Callback for viewing details

#### `puzzle-products-filters.tsx`

Advanced filtering component with:

- Brand selection
- Piece count range (min/max)
- Difficulty filter
- Category filter
- Tag selection
- Custom range inputs

**Features:**

- Dynamic brand/category options from existing products
- Tag management with add/remove functionality
- Responsive grid layout

#### `puzzle-product-view-provider.tsx`

Context provider for managing view modes (grid/list) and providing layout classes.

### Detail Page Components

#### `puzzle-product-detail.tsx`

Comprehensive product detail view showing:

- Large product image
- Full description
- All product metadata
- Action buttons
- Creation/update dates

## Data Flow

1. **Initial Load**: `usePaginatedQuery` loads first 20 products
2. **Infinite Scroll**: Intersection observer triggers loading more products
3. **Filtering**: Client-side filtering based on user selections
4. **Search**: Real-time search across title, description, brand
5. **Navigation**: Click handlers route to detail pages or add puzzle flow

## Internationalization

All text content is internationalized using `next-intl` with the following structure:

- `puzzles.products.*` - Main product page translations
- `puzzles.products.filters.*` - Filter-specific translations
- `puzzles.products.difficulty.*` - Difficulty level translations

## Styling

- Uses Tailwind CSS for responsive design
- Grid layout adapts from 1 column (mobile) to 4 columns (xl screens)
- Consistent card-based design with proper spacing
- Loading states and empty states handled gracefully

## Performance Considerations

- Infinite scroll with 20 items per page
- Client-side filtering for immediate response
- Lazy loading of images
- Efficient re-renders with proper React patterns
- Intersection observer for scroll detection

## Usage

```tsx
// In a page component
import { PuzzlesClient } from "./_components/puzzle-products-client";

export default function PuzzlesProductsPage() {
  return <PuzzlesClient />;
}
```

## Dependencies

- `convex/react` - For data fetching and pagination
- `next-intl` - For internationalization
- `lucide-react` - For icons
- `@/components/ui/*` - For UI components

# Personal Library API Documentation

This document describes the backend API for the Personal Library feature in JigSwap.

## Database Schema

### New Tables Added

#### `collections`

User-puzzle relationships with visibility settings and ownership status.

```typescript
{
  userId: Id<'users'>,
  puzzleId: Id<'puzzles'>,
  visibility: 'private' | 'visible' | 'lendable' | 'swappable' | 'tradeable',
  customTags?: string[],
  personalNotes?: string,
  acquisitionDate?: number,
  acquisitionSource?: string, // e.g., "gift", "purchase", "trade"
  acquisitionPrice?: number,
  isWishlist: boolean, // false = owned, true = wishlist
  createdAt: number,
  updatedAt: number,
}
```

#### `completions`

Detailed completion records with timing, rating, notes, and photos.

```typescript
{
  userId: Id<'users'>,
  puzzleId: Id<'puzzles'>,
  startDate: number,
  endDate: number,
  completionTimeMinutes: number,
  rating?: number, // 1-5 stars
  review?: string,
  notes?: string,
  photos: string[], // Array of photo URLs (max 5)
  isCompleted: boolean, // true = completed, false = in progress
  createdAt: number,
  updatedAt: number,
}
```

#### `categories`

User-defined organization system for collections.

```typescript
{
  userId: Id<'users'>,
  name: string,
  color?: string, // hex color code
  description?: string,
  isDefault: boolean, // true for system categories, false for user-created
  createdAt: number,
  updatedAt: number,
}
```

#### `goals`

User goals for puzzle completion.

```typescript
{
  userId: Id<'users'>,
  title: string,
  description?: string,
  targetCompletions: number,
  currentCompletions: number,
  targetDate?: number,
  isActive: boolean,
  createdAt: number,
  updatedAt: number,
}
```

## API Endpoints

### Collection Management

#### `addToCollection`

Add a puzzle to user's collection.

**Arguments:**

```typescript
{
  puzzleId: Id<'puzzles'>,
  visibility: 'private' | 'visible' | 'lendable' | 'swappable' | 'tradeable',
  customTags?: string[],
  personalNotes?: string,
  acquisitionDate?: number,
  acquisitionSource?: string,
  acquisitionPrice?: number,
  isWishlist?: boolean,
}
```

**Returns:** `Id<'collections'>`

#### `getCollection`

Get user's collection with filtering and pagination.

**Arguments:**

```typescript
{
  userId?: Id<'users'>, // defaults to current user
  includeWishlist?: boolean,
  visibility?: 'private' | 'visible' | 'lendable' | 'swappable' | 'tradeable',
  searchTerm?: string,
  category?: string,
  minPieceCount?: number,
  maxPieceCount?: number,
  difficulty?: 'easy' | 'medium' | 'hard' | 'expert',
  tags?: string[],
  limit?: number, // defaults to 20
  offset?: number, // defaults to 0
}
```

**Returns:**

```typescript
{
  collections: Array<{
    ...collection,
    puzzle: Puzzle,
  }>,
  total: number,
  hasMore: boolean,
}
```

#### `updateCollection`

Update collection item details.

**Arguments:**

```typescript
{
  collectionId: Id<'collections'>,
  visibility?: 'private' | 'visible' | 'lendable' | 'swappable' | 'tradeable',
  customTags?: string[],
  personalNotes?: string,
  acquisitionDate?: number,
  acquisitionSource?: string,
  acquisitionPrice?: number,
  isWishlist?: boolean,
}
```

#### `removeFromCollection`

Remove puzzle from collection.

**Arguments:**

```typescript
{
  collectionId: Id<'collections'>,
}
```

### Completion Tracking

#### `startCompletion`

Start tracking a puzzle completion.

**Arguments:**

```typescript
{
  puzzleId: Id<'puzzles'>,
  startDate?: number, // defaults to current time
}
```

**Returns:** `Id<'completions'>`

#### `completePuzzle`

Mark a puzzle as completed with details.

**Arguments:**

```typescript
{
  completionId: Id<'completions'>,
  endDate?: number, // defaults to current time
  rating?: number, // 1-5 stars
  review?: string,
  notes?: string,
  photos?: string[], // Array of photo URLs
}
```

#### `getCompletionHistory`

Get completion history for a specific puzzle.

**Arguments:**

```typescript
{
  puzzleId: Id<'puzzles'>,
}
```

**Returns:** `Array<Completion>` (sorted by completion date, newest first)

#### `getCompletionStats`

Get user's completion statistics and analytics.

**Arguments:**

```typescript
{
  userId?: Id<'users'>, // defaults to current user
}
```

**Returns:**

```typescript
{
  totalCompletions: number,
  totalTimeMinutes: number,
  averageTimeMinutes: number,
  averageRating: number,
  brandDistribution: Array<[string, number]>,
  difficultyDistribution: Array<[string, number]>,
  recentCompletions: Array<Completion>,
}
```

### Categories

#### `createCategory`

Create a new category for organizing collections.

**Arguments:**

```typescript
{
  name: string,
  color?: string, // hex color code
  description?: string,
}
```

**Returns:** `Id<'categories'>`

#### `getCategories`

Get user's categories.

**Arguments:** `{}`

**Returns:** `Array<Category>` (sorted: default categories first, then alphabetically)

#### `updateCategory`

Update category details.

**Arguments:**

```typescript
{
  categoryId: Id<'categories'>,
  name?: string,
  color?: string,
  description?: string,
}
```

#### `deleteCategory`

Delete a category (cannot delete default categories).

**Arguments:**

```typescript
{
  categoryId: Id<'categories'>,
}
```

### Goals

#### `createGoal`

Create a new completion goal.

**Arguments:**

```typescript
{
  title: string,
  description?: string,
  targetCompletions: number,
  targetDate?: number,
}
```

**Returns:** `Id<'goals'>`

#### `getGoals`

Get user's goals.

**Arguments:**

```typescript
{
  includeInactive?: boolean, // defaults to false
}
```

**Returns:** `Array<Goal>` (sorted by creation date, newest first)

#### `updateGoal`

Update goal details.

**Arguments:**

```typescript
{
  goalId: Id<'goals'>,
  title?: string,
  description?: string,
  targetCompletions?: number,
  currentCompletions?: number,
  targetDate?: number,
  isActive?: boolean,
}
```

#### `deleteGoal`

Delete a goal.

**Arguments:**

```typescript
{
  goalId: Id<'goals'>,
}
```

### Analytics

#### `getUserAnalytics`

Get comprehensive user analytics.

**Arguments:**

```typescript
{
  userId?: Id<'users'>, // defaults to current user
}
```

**Returns:**

```typescript
{
  collection: {
    totalOwned: number,
    totalWishlist: number,
    pieceCountDistribution: Array<[number, number]>,
    brandDistribution: Array<[string, number]>,
    difficultyDistribution: Array<[string, number]>,
  },
  completions: {
    total: number,
    totalTimeMinutes: number,
    averageTimeMinutes: number,
    averageRating: number,
    monthlyTrends: Array<[string, number]>, // "YYYY-MM" format
  },
}
```

#### `exportUserData`

Export all user data in JSON format.

**Arguments:** `{}`

**Returns:**

```typescript
{
  user: User,
  collections: Array<CollectionWithPuzzle>,
  completions: Array<CompletionWithPuzzle>,
  categories: Array<Category>,
  goals: Array<Goal>,
  exportDate: number,
}
```

### Enhanced Puzzle Functions

#### `getPuzzleWithCollectionStatus`

Get puzzle details with collection status for current user.

**Arguments:**

```typescript
{
  puzzleId: Id<'puzzles'>,
}
```

**Returns:**

```typescript
{
  ...Puzzle,
  owner: User,
  collectionStatus: {
    isInCollection: boolean,
    visibility?: 'private' | 'visible' | 'lendable' | 'swappable' | 'tradeable',
    customTags?: string[],
    personalNotes?: string,
    isWishlist?: boolean,
    acquisitionDate?: number,
    acquisitionSource?: string,
    acquisitionPrice?: number,
  },
  completionHistory: Array<Completion>,
}
```

#### `getRecommendedPuzzles`

Get puzzles recommended based on user's collection preferences.

**Arguments:**

```typescript
{
  limit?: number, // defaults to 10
  excludeOwned?: boolean, // defaults to false
}
```

**Returns:** `Array<PuzzleWithOwner>`

#### `getPuzzleStats`

Get statistics for a specific puzzle.

**Arguments:**

```typescript
{
  puzzleId: Id<'puzzles'>,
}
```

**Returns:**

```typescript
{
  puzzle: Puzzle,
  stats: {
    totalCompletions: number,
    totalCollections: number,
    averageRating: number,
    averageTimeMinutes: number,
    completionHistory: Array<Completion>,
  },
}
```

## Usage Examples

### Adding a puzzle to collection

```typescript
const collectionId = await convex.mutation("personal-library:addToCollection")({
  puzzleId: "puzzle_id",
  visibility: "visible",
  customTags: ["favorite", "landscape"],
  personalNotes: "Beautiful puzzle with vibrant colors",
  acquisitionDate: Date.now(),
  acquisitionSource: "gift",
  isWishlist: false,
});
```

### Getting user's collection

```typescript
const collection = await convex.query("personal-library:getCollection")({
  includeWishlist: false,
  searchTerm: "landscape",
  minPieceCount: 500,
  maxPieceCount: 1000,
  difficulty: "medium",
});
```

### Starting a completion

```typescript
const completionId = await convex.mutation("personal-library:startCompletion")({
  puzzleId: "puzzle_id",
});
```

### Completing a puzzle

```typescript
await convex.mutation("personal-library:completePuzzle")({
  completionId: "completion_id",
  rating: 5,
  review: "Amazing puzzle! Loved the colors and quality.",
  notes: "Completed with family over the weekend",
  photos: ["photo_url_1", "photo_url_2"],
});
```

### Getting analytics

```typescript
const analytics = await convex.query("personal-library:getUserAnalytics")({});
console.log(`Total completions: ${analytics.completions.total}`);
console.log(`Average rating: ${analytics.completions.averageRating}`);
```

## Error Handling

All mutations will throw errors for:

- Unauthenticated users
- Invalid puzzle/collection/completion IDs
- Duplicate entries (e.g., adding same puzzle to collection twice)
- Invalid data (e.g., rating outside 1-5 range)

All queries will return `null` for unauthenticated users.

## Indexes

The following indexes are available for efficient querying:

- `collections.by_user` - Get all collections for a user
- `collections.by_puzzle` - Get all collections for a puzzle
- `collections.by_user_puzzle` - Get specific user-puzzle collection
- `collections.by_visibility` - Filter by visibility level
- `collections.by_wishlist` - Filter by wishlist status
- `completions.by_user` - Get all completions for a user
- `completions.by_puzzle` - Get all completions for a puzzle
- `completions.by_user_puzzle` - Get specific user-puzzle completions
- `completions.by_completion_date` - Sort by completion date
- `completions.by_rating` - Filter by rating
- `categories.by_user` - Get all categories for a user
- `categories.by_user_name` - Get specific category by name
- `goals.by_user` - Get all goals for a user
- `goals.by_user_active` - Get active goals for a user

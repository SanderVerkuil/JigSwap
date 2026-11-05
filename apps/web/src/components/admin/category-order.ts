import { arrayMove } from "@dnd-kit/sortable";

export interface CategoryOrderEntry {
  catalogCategoryId: string;
  sortOrder: number;
}

// The reorder mutation's `order` for moving the category at `from` to `to`:
// the whole list renumbered 0..n-1 in its new order. Shared by drag-and-drop
// and the row menu's Move up / Move down. Legacy rows without an aggregateId
// cannot be addressed by the domain, so they are left out but keep their slot
// in the numbering. Null when nothing would move.
export function moveCategoryOrder(
  categories: readonly { aggregateId?: string }[],
  from: number,
  to: number,
): CategoryOrderEntry[] | null {
  const inRange = (index: number) => index >= 0 && index < categories.length;
  if (from === to || !inRange(from) || !inRange(to)) return null;
  return arrayMove([...categories], from, to).flatMap((category, index) =>
    category.aggregateId === undefined
      ? []
      : [{ catalogCategoryId: category.aggregateId, sortOrder: index }],
  );
}

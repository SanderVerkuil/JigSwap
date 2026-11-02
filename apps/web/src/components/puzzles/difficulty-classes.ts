// Difficulty colour swatch, matching the shared PuzzleCard / copy-instance scheme. Its own module:
// every puzzle card uses it, and catalog-detail-parts would bring the avatar and member-name code
// (and zod behind @jigswap/contracts) into the first load of every page with a card grid.
export function difficultyClasses(difficulty?: string) {
  switch (difficulty) {
    case "easy":
      return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200";
    case "medium":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200";
    case "hard":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200";
    case "expert":
      return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}

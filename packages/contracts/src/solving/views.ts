// Solving read-model view DTOs: typed shapes the gateway's `solving:` reads return where the UI
// must not receive raw completion rows (friend-facing or cross-context surfaces).

/**
 * How precisely a finished solve is dated. "day" is a real date; "year" is "sometime in 2023"
 * (its dates are a mid-year sentinel); "unknown" is undated (its dates are the logging instant).
 * Views carry it so the UI labels a solve "In 2023" / "Date unknown" instead of a fake date; an
 * absent value means "day".
 */
export type CompletionDatePrecision = "day" | "year" | "unknown";

/**
 * One of the acting member's in-progress solves (dashboard / self surfaces). Excludes notes,
 * photos, and internal row ids by construction — only what the card renders.
 */
export interface InProgressSolveView {
  /** Solving CompletionId aggregateId (used to finish/edit/delete). */
  completionId: string;
  title?: string;
  pieceCount?: number;
  /** Epoch ms; may be in the future (user-editable). */
  startDate: number;
  /** Library CopyId aggregateId from the durable snapshot, when the solve was logged on a copy. */
  copyId?: string;
  /** Catalog box-art URL when the puzzle definition has one. Never a completion photo. */
  thumbnailUrl?: string;
}

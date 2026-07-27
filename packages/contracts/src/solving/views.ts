// Solving read-model view DTOs: typed shapes the gateway's `solving:` reads return where the UI
// must not receive raw completion rows (friend-facing or cross-context surfaces).

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

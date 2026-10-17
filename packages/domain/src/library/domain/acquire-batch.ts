import { err, ok, type Result } from "../../shared-kernel";
import { LibraryError } from "./errors";
import { PuzzleDefinitionId } from "./ids";

// The most definitions one batch add may acquire (counted after deduplication). Keeps a single
// transaction's reads and writes bounded, and matches the quick-start picker's tray.
export const MAX_ACQUIRE_BATCH = 25;

export interface AcquireBatchRequest {
  readonly puzzleDefinitionId: PuzzleDefinitionId;
  readonly forTrade?: boolean;
}

export interface AcquireBatchItem {
  readonly puzzleDefinitionId: PuzzleDefinitionId;
  readonly forTrade: boolean;
}

// Normalise a requested batch add: duplicates collapse to their first occurrence (one copy per
// definition per batch), each item's forTrade defaults to false (the SharingSetting default),
// and an empty batch or more distinct definitions than the cap reject the whole batch.
export const planAcquireBatch = (
  requests: readonly AcquireBatchRequest[],
): Result<AcquireBatchItem[], LibraryError> => {
  const byDefinition = new Map<PuzzleDefinitionId, AcquireBatchItem>();
  for (const request of requests) {
    if (byDefinition.has(request.puzzleDefinitionId)) continue;
    byDefinition.set(request.puzzleDefinitionId, {
      puzzleDefinitionId: request.puzzleDefinitionId,
      forTrade: request.forTrade ?? false,
    });
  }
  const items = [...byDefinition.values()];
  if (items.length === 0) return err(LibraryError.emptyAcquireBatch());
  if (items.length > MAX_ACQUIRE_BATCH)
    return err(LibraryError.acquireBatchTooLarge(MAX_ACQUIRE_BATCH));
  return ok(items);
};

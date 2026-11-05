import { err, ok, type Result } from "../../shared-kernel";
import { LibraryError } from "./errors";
import { CopyId } from "./ids";

// The most copies one bulk offer change may touch (counted after deduplication). Keeps a single
// transaction's reads and writes bounded; the web sends a larger selection in chunks of this size.
export const MAX_OFFERS_BATCH = 100;

// Normalise the copies of a bulk offer change: duplicates collapse to their first occurrence (each
// copy is changed once), and more distinct copies than the cap reject the whole batch.
export const planOffersBatch = (
  copyIds: readonly CopyId[],
): Result<CopyId[], LibraryError> => {
  const unique = [...new Set(copyIds)];
  if (unique.length > MAX_OFFERS_BATCH)
    return err(LibraryError.offersBatchTooLarge(MAX_OFFERS_BATCH));
  return ok(unique);
};

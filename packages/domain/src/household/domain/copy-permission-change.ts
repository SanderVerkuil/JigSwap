import { err, ok, type Result } from "../../shared-kernel";
import {
  type HouseholdCopyFacts,
  type HouseholdCopyPermission,
  resolveHouseholdCopyPermission,
} from "./copy-access";
import { HouseholdError } from "./errors";
import { MemberId } from "./ids";

// The most copies one bulk permission change may touch (counted after deduplication). Keeps a
// single transaction's reads and writes bounded.
export const MAX_HOUSEHOLD_PERMISSION_BATCH = 200;

// THE rule for changing one copy's household permission: only the copy's OWNER may (a household
// manager may not, or they could escalate or lock out the owner's choice). Ok(true) when the
// effective permission (absent = default) differs from the target and a write is needed.
export const householdPermissionChange = (
  copy: HouseholdCopyFacts,
  actorId: MemberId,
  target: HouseholdCopyPermission,
): Result<boolean, HouseholdError> => {
  if (copy.ownerId !== actorId) return err(HouseholdError.notCopyOwner());
  return ok(
    resolveHouseholdCopyPermission(copy.householdPermission) !== target,
  );
};

// Normalise a requested batch of copy ids: duplicates collapse (first-seen order), and more
// distinct ids than the cap reject the batch.
export const dedupeHouseholdPermissionBatch = <Id extends string>(
  ids: readonly Id[],
): Result<Id[], HouseholdError> => {
  const unique = [...new Set(ids)];
  if (unique.length > MAX_HOUSEHOLD_PERMISSION_BATCH) {
    return err(
      HouseholdError.permissionBatchTooLarge(MAX_HOUSEHOLD_PERMISSION_BATCH),
    );
  }
  return ok(unique);
};

// Apply the single-copy rule to every copy of a batch, all-or-nothing: one copy the actor does
// not own rejects the whole batch. Otherwise returns the copies that need a write and how many are
// already at the target.
export const planHouseholdPermissionBatch = <C extends HouseholdCopyFacts>(
  copies: readonly C[],
  actorId: MemberId,
  target: HouseholdCopyPermission,
): Result<{ toChange: C[]; unchanged: number }, HouseholdError> => {
  const toChange: C[] = [];
  for (const copy of copies) {
    const change = householdPermissionChange(copy, actorId, target);
    if (change.isErr) return change;
    if (change.value) toChange.push(copy);
  }
  return ok({ toChange, unchanged: copies.length - toChange.length });
};

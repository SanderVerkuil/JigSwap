import { err, ok, type Result } from "../../shared-kernel";
import {
  type HouseholdCopyFacts,
  type HouseholdCopyPermission,
} from "./copy-access";
import { HouseholdError } from "./errors";
import { MemberId } from "./ids";

// The most copies one bulk permission change may touch (counted after deduplication). Keeps a
// single transaction's reads and writes bounded.
export const MAX_HOUSEHOLD_PERMISSION_BATCH = 200;

// What an owner may choose for a copy: an explicit permission, or "default" to clear the explicit
// value so the copy follows its household's default.
export type HouseholdCopyPermissionChoice = HouseholdCopyPermission | "default";

// The stored per-copy value a choice writes (undefined = no explicit value).
export const storedHouseholdPermission = (
  choice: HouseholdCopyPermissionChoice,
): HouseholdCopyPermission | undefined =>
  choice === "default" ? undefined : choice;

// THE rule for changing one copy's household permission: only the copy's OWNER may (a household
// manager may not, or they could escalate or lock out the owner's choice). Ok(true) when the
// stored explicit value differs from what the choice stores, i.e. a write is needed. An explicit
// choice equal to what the copy inherits today is still written: it pins the copy against later
// changes of the household default.
export const householdPermissionChange = (
  copy: HouseholdCopyFacts,
  actorId: MemberId,
  choice: HouseholdCopyPermissionChoice,
): Result<boolean, HouseholdError> => {
  if (copy.ownerId !== actorId) return err(HouseholdError.notCopyOwner());
  return ok(copy.householdPermission !== storedHouseholdPermission(choice));
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
  choice: HouseholdCopyPermissionChoice,
): Result<{ toChange: C[]; unchanged: number }, HouseholdError> => {
  const toChange: C[] = [];
  for (const copy of copies) {
    const change = householdPermissionChange(copy, actorId, choice);
    if (change.isErr) return change;
    if (change.value) toChange.push(copy);
  }
  return ok({ toChange, unchanged: copies.length - toChange.length });
};

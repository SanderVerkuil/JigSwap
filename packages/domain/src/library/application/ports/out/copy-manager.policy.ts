import { CopyId, OwnerId } from "../../../domain";

// Outbound port: may a member OTHER than the owner manage this copy as if they owned it? The
// adapter answers from the Household context (same household AND the owner left the copy's
// household permission at `manage`). Library only asks; it never learns why.
export interface CopyManagerPolicy {
  canManage(
    copy: { readonly id: CopyId; readonly ownerId: OwnerId },
    actorId: OwnerId,
  ): Promise<boolean>;
}

// The owner always manages; anyone else only when a policy is wired AND vouches for them. No
// policy ⇒ owner-only, the conservative default for composition roots that don't opt in.
export const mayManageCopy = async (
  copy: { readonly id: CopyId; readonly ownerId: OwnerId },
  actorId: OwnerId,
  policy: CopyManagerPolicy | undefined,
): Promise<boolean> =>
  copy.ownerId === actorId ||
  (policy !== undefined && (await policy.canManage(copy, actorId)));

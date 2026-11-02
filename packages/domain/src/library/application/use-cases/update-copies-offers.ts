import { err, ok } from "../../../shared-kernel";
import { CopyId, planOffersBatch } from "../../domain";
import {
  CopyOffersSkipReason,
  UpdateCopiesOffers,
  UpdateCopiesOffersCommand,
} from "../ports/in/update-copies-offers.port";
import { mayManageCopy } from "../ports/out/copy-manager.policy";
import {
  makeUpdateCopySharing,
  UpdateCopySharingDeps,
} from "./update-copy-sharing";

// Bulk form of updateCopySharing for My Puzzles' selection: offer many copies for swap or to lend,
// or withdraw their offers, in one call. Each copy goes through the SAME single-copy use case
// (manager check, reservation guard), with only its offers changed: no visibility and no price, so
// every copy keeps its owner's visibility choice and stored price. A copy the caller may not
// manage, one out on loan, or one an active exchange reserves, is skipped with the reason instead
// of failing the batch; a copy already as asked is not rewritten. The manager check comes first, so
// a skipped copy never reveals its offers or its loan. Any other refusal fails the batch (the
// transport runs it as one transaction, so nothing is written then).
export const makeUpdateCopiesOffers = (
  deps: UpdateCopySharingDeps,
): UpdateCopiesOffers => {
  const share = makeUpdateCopySharing(deps);
  return async (cmd: UpdateCopiesOffersCommand) => {
    const plan = planOffersBatch(cmd.copyIds);
    if (plan.isErr) return err(plan.error);

    let updated = 0;
    let unchanged = 0;
    const skipped: { copyId: CopyId; reason: CopyOffersSkipReason }[] = [];
    for (const copyId of plan.value) {
      const copy = await deps.copies.findById(copyId);
      if (
        !copy ||
        !(await mayManageCopy(copy, cmd.actingMemberId, deps.managers))
      ) {
        skipped.push({ copyId, reason: "notAllowed" });
        continue;
      }
      // Lending a copy took it off the market (Copy.lendOut); it stays off until it is back. The
      // copy page locks its offer switches the same way, and a manager may not know of a
      // housemate's loan, so the rule lives here rather than in the client.
      if (copy.heldBy !== copy.ownerId) {
        skipped.push({ copyId, reason: "onLoan" });
        continue;
      }

      const { sharing } = copy;
      const offers = {
        forTrade: cmd.offers.forTrade ?? sharing.forTrade,
        forLend: cmd.offers.forLend ?? sharing.forLend,
        forSale: cmd.offers.forSale ?? sharing.forSale,
      };
      if (
        offers.forTrade === sharing.forTrade &&
        offers.forLend === sharing.forLend &&
        offers.forSale === sharing.forSale
      ) {
        unchanged += 1;
        continue;
      }

      const result = await share({
        actingMemberId: cmd.actingMemberId,
        copyId,
        ...offers,
      });
      if (result.isErr) {
        if (result.error.code === "CopyReserved") {
          skipped.push({ copyId, reason: "reserved" });
          continue;
        }
        return err(result.error);
      }
      updated += 1;
    }
    return ok({ updated, unchanged, skipped });
  };
};

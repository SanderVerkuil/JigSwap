import { Exchange } from "../../domain";
import { ApplicationError } from "../errors";
import { CopyPort } from "../ports/out/copy.port";
import { mayOfferCopy } from "./propose-exchange";

// Ownership is checked when a deal is proposed, but a copy can change hands while the deal is open
// (another deal settles on it, a housemate leaves the household). Settlement moves the copies it
// names, so it may only happen while they are still where the deal found them:
//   - the requested copy still belongs to the recipient (CopyNotFound / RecipientNotOwner);
//   - for a swap, the offered copy is still one the initiator may offer (their own, or a housemate's
//     they co-manage, never the recipient's) and, when recorded at propose time, still has that
//     owner (CopyNotFound / OfferedCopyNotOwned). Swaps proposed before the owner was recorded fall
//     back to the offer rule alone.
// The offered copy counts exactly when settlement transfers it (a swap that names one).
// Accept and confirm-completion run it before saving, so a refusal leaves the exchange untouched.
export const settlementGuard =
  (copies: CopyPort) =>
  async (exchange: Exchange): Promise<ApplicationError | null> => {
    const state = exchange.toState();

    const requested = await copies.getCopy(state.requestedCopyId);
    if (!requested) return ApplicationError.copyNotFound(state.requestedCopyId);
    if (requested.ownerId !== state.recipientId) {
      return ApplicationError.recipientNotOwner(state.requestedCopyId);
    }

    if (state.kind !== "swap" || !state.offeredCopyId) return null;
    const offered = await copies.getCopy(state.offeredCopyId);
    if (!offered) return ApplicationError.copyNotFound(state.offeredCopyId);
    const ownerUnchanged =
      state.offeredCopyOwnerId === undefined ||
      offered.ownerId === state.offeredCopyOwnerId;
    if (
      !ownerUnchanged ||
      !mayOfferCopy(offered, state.initiatorId, state.recipientId)
    ) {
      return ApplicationError.offeredCopyNotOwned(state.offeredCopyId);
    }
    return null;
  };

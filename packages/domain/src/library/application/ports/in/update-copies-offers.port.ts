import { Result } from "../../../../shared-kernel";
import { CopyId, LibraryError, OwnerId } from "../../../domain";
import { LibraryApplicationError } from "../../errors";

// The offers a bulk change sets. A flag that is given replaces that offer on every copy; an omitted
// flag keeps each copy's own value. Withdrawing every offer gives all three as false.
export interface CopyOffersChange {
  readonly forTrade?: boolean;
  readonly forLend?: boolean;
  readonly forSale?: boolean;
}

// Command to change the offers of many copies at once (My Puzzles' bulk actions). It carries no
// visibility and no price: every copy keeps its owner's visibility choice and its stored price.
export interface UpdateCopiesOffersCommand {
  readonly actingMemberId: OwnerId;
  readonly copyIds: readonly CopyId[];
  readonly offers: CopyOffersChange;
}

// Why a copy of the batch was left as it was:
// - "notAllowed": no such copy, or the caller may not manage it (one answer for both, so the
//   batch reveals nothing about copies the caller can't manage);
// - "onLoan": it is out on loan, so it stays off the market until it is back;
// - "reserved": an active exchange reserves it, so it can't be offered.
export type CopyOffersSkipReason = "notAllowed" | "onLoan" | "reserved";

export interface UpdateCopiesOffersResult {
  // Copies whose offers changed.
  readonly updated: number;
  // Copies that already had the asked offers (not rewritten).
  readonly unchanged: number;
  readonly skipped: readonly {
    readonly copyId: CopyId;
    readonly reason: CopyOffersSkipReason;
  }[];
}

export interface UpdateCopiesOffers {
  (
    cmd: UpdateCopiesOffersCommand,
  ): Promise<
    Result<UpdateCopiesOffersResult, LibraryError | LibraryApplicationError>
  >;
}

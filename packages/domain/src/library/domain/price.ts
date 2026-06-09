import { err, ok, Result } from "../../shared-kernel";
import { LibraryError } from "./errors";

// Money as positive integer minor units (cents) plus an ISO-4217 currency, avoiding
// floating-point money bugs. Defined LOCALLY (not shared with Exchange's Money) to keep the
// contexts decoupled; the persisted `ownedPuzzles.salePrice` is { amount, currency }.
export class Price {
  private constructor(
    readonly amountCents: number,
    readonly currency: string,
  ) {}

  static create(
    amountCents: number,
    currency: string,
  ): Result<Price, LibraryError> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return err(
        LibraryError.invalidPrice("amount must be a positive integer (cents)"),
      );
    }
    if (currency.length !== 3) {
      return err(
        LibraryError.invalidPrice("currency must be a 3-letter ISO code"),
      );
    }
    return ok(new Price(amountCents, currency.toUpperCase()));
  }

  // Rehydrate a persisted value that was already validated when first stored.
  static fromState(amountCents: number, currency: string): Price {
    return new Price(amountCents, currency);
  }
}

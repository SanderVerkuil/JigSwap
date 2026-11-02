import { err, ok, Result } from "../../shared-kernel";
import { LibraryError } from "./errors";

// The highest price a copy can carry: a million in the major unit. Far above any puzzle; it only
// keeps nonsense (1e300 is an integer too) off a screen other members read.
export const MAX_PRICE_CENTS = 100_000_000;

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
    if (amountCents > MAX_PRICE_CENTS) {
      return err(LibraryError.invalidPrice("amount is too high"));
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

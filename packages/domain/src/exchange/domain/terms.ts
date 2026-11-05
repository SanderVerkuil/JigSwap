import { err, ok, Result } from "../../shared-kernel";
import { ExchangeError } from "./errors";
import { CopyId } from "./ids";

// The highest price a sale can carry: a million in the major unit. Far above any puzzle; it only
// keeps nonsense (1e300 is an integer too) off the other party's screen.
export const MAX_MONEY_CENTS = 100_000_000;

// How far a return date may lie: from yesterday (a member's today can be behind UTC's) to ten years.
const RETURN_DATE_PAST_MS = 24 * 60 * 60 * 1000;
const RETURN_DATE_AHEAD_MS = 10 * 365 * 24 * 60 * 60 * 1000;

const isPossibleReturnDate = (date: Date, now: Date): boolean => {
  const at = date.getTime();
  return (
    at >= now.getTime() - RETURN_DATE_PAST_MS &&
    at <= now.getTime() + RETURN_DATE_AHEAD_MS
  );
};

// Money as positive integer minor units (cents) plus an ISO-4217 currency, avoiding
// floating-point money bugs. Immutable value object validated at construction.
export class Money {
  private constructor(
    readonly amountCents: number,
    readonly currency: string,
  ) {}

  static create(
    amountCents: number,
    currency: string,
  ): Result<Money, ExchangeError> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return err(
        ExchangeError.missingTerms(
          "sale",
          "price must be a positive integer (cents)",
        ),
      );
    }
    if (amountCents > MAX_MONEY_CENTS) {
      return err(ExchangeError.missingTerms("sale", "the price is too high"));
    }
    if (currency.length !== 3) {
      return err(
        ExchangeError.missingTerms(
          "sale",
          "currency must be a 3-letter ISO code",
        ),
      );
    }
    return ok(new Money(amountCents, currency.toUpperCase()));
  }

  // Rehydrate a persisted value that was already validated when first stored.
  static fromState(amountCents: number, currency: string): Money {
    return new Money(amountCents, currency);
  }
}

// Discriminated terms: exactly the data each kind requires, nothing more. The aggregate
// trusts a constructed ExchangeTerms to already be valid for its kind.
export type ExchangeTerms =
  | { readonly kind: "swap"; readonly offeredCopyId: CopyId }
  | { readonly kind: "sale"; readonly price: Money }
  | { readonly kind: "lend"; readonly returnDate?: Date };

// Raw, kind-tagged input as it arrives from the boundary; validated into ExchangeTerms.
export type ExchangeTermsInput =
  | { readonly kind: "swap"; readonly offeredCopyId?: CopyId }
  | { readonly kind: "sale"; readonly price?: Money }
  | { readonly kind: "lend"; readonly returnDate?: Date };

// Enforce term validity per kind: swap needs an offered copy, sale a price. A lend is open-ended —
// returnDate is an optional, advisory expected-return, never required, but when given it has to be
// a date the loan can end on.
export const validateTerms = (
  input: ExchangeTermsInput,
  now: Date,
): Result<ExchangeTerms, ExchangeError> => {
  switch (input.kind) {
    case "swap":
      if (!input.offeredCopyId) {
        return err(
          ExchangeError.missingTerms("swap", "an offered copy is required"),
        );
      }
      return ok({ kind: "swap", offeredCopyId: input.offeredCopyId });
    case "sale":
      if (!input.price) {
        return err(ExchangeError.missingTerms("sale", "a price is required"));
      }
      return ok({ kind: "sale", price: input.price });
    case "lend":
      if (input.returnDate && !isPossibleReturnDate(input.returnDate, now)) {
        return err(
          ExchangeError.missingTerms("lend", "the return date isn't possible"),
        );
      }
      return ok({ kind: "lend", returnDate: input.returnDate });
  }
};

import { err, ok, Result } from "../../shared-kernel";
import { ExchangeError } from "./errors";
import { CopyId } from "./ids";

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
// returnDate is an optional, advisory expected-return, never required.
export const validateTerms = (
  input: ExchangeTermsInput,
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
      return ok({ kind: "lend", returnDate: input.returnDate });
  }
};

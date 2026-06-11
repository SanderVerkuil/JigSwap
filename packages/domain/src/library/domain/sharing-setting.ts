import { Price } from "./price";

// The kinds of exchange a Copy can be offered for. Mirrors the persisted
// `ownedPuzzles.availability` flags (forTrade/forSale/forLend) which the Exchange context
// reads through its CopyPort.
export type ExchangeAvailabilityKind = "trade" | "sale" | "lend";

// Base reach of a Copy. The spec documents a 6-level visibility model
// (private / friend-circle / visible / lendable / swappable / tradeable). This VO
// consolidates today's fragmented availability into ONE place by splitting that model into
// two orthogonal axes:
//   - `visibility`  -> who can SEE the copy: "private" (only owner) | "visible" (public).
//   - the exchange-availability flags below -> what it can be USED for (lendable/swappable/
//     tradeable), each of which also implies the copy is at least visible.
// NOTE: the "friend-circle" level is Phase 6 (Friend Circles); it plugs in later as a third
// visibility value plus a scoping predicate in the VisibilityPolicy port, without changing
// this VO's shape.
export type Visibility = "private" | "visible";

export class SharingSetting {
  private constructor(
    readonly visibility: Visibility,
    readonly forTrade: boolean,
    readonly forSale: boolean,
    readonly forLend: boolean,
    readonly salePrice?: Price,
  ) {}

  // The safe default for a freshly acquired Copy: private, not offered for anything.
  static private(): SharingSetting {
    return new SharingSetting("private", false, false, false);
  }

  static create(props: {
    readonly visibility: Visibility;
    readonly forTrade?: boolean;
    readonly forSale?: boolean;
    readonly forLend?: boolean;
    readonly salePrice?: Price;
  }): SharingSetting {
    return new SharingSetting(
      props.visibility,
      props.forTrade ?? false,
      props.forSale ?? false,
      props.forLend ?? false,
      props.salePrice,
    );
  }

  // Is this copy offered for the given exchange kind? swappable⇒trade, tradeable⇒sale,
  // lendable⇒lend (the spec's level names map onto these flags).
  isAvailableFor(kind: ExchangeAvailabilityKind): boolean {
    switch (kind) {
      case "trade":
        return this.forTrade;
      case "sale":
        return this.forSale;
      case "lend":
        return this.forLend;
    }
  }

  // Offered for at least one kind of exchange.
  isAvailableForAnyExchange(): boolean {
    return this.forTrade || this.forSale || this.forLend;
  }

  // Anyone other than the owner may see this copy when it is public or offered for exchange
  // (an exchange offer is meaningless if the copy is invisible). Friend-circle scoping is
  // layered on top of this in Phase 6.
  isPubliclyVisible(): boolean {
    return this.visibility === "visible" || this.isAvailableForAnyExchange();
  }
}

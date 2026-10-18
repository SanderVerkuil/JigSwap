import { Price } from "./price";

// The kinds of exchange a Copy can be offered for. Mirrors the persisted
// `ownedPuzzles.availability` flags (forTrade/forSale/forLend) which the Exchange context
// reads through its CopyPort.
export type ExchangeAvailabilityKind = "trade" | "sale" | "lend";

// Base reach of a Copy. The spec documents a 6-level visibility model
// (private / friend-circle / visible / lendable / swappable / tradeable). This VO
// consolidates today's fragmented availability into ONE place by splitting that model into
// two orthogonal axes:
//   - `visibility`  -> who can SEE the copy: "private" (only the owner, plus whoever physically
//     holds it and the owner's household — enforced by the read-side gate) | "visible".
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

  // The default for a freshly acquired Copy (and for a copy arriving with a new owner): visible
  // to the community, not offered for anything. The owner may make it private afterwards.
  static newCopy(): SharingSetting {
    return new SharingSetting("visible", false, false, false);
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

  // The same visibility with every exchange offer (and the sale price) withdrawn: the copy leaves
  // the market but keeps who-can-see-it as the owner chose.
  withoutOffers(): SharingSetting {
    return new SharingSetting(this.visibility, false, false, false);
  }

  // A copy offered for exchange must be visible: an offer nobody can see is meaningless. Checked
  // on write by Copy.updateSharing (CopyMustBeVisibleToOffer).
  offersWhilePrivate(): boolean {
    return this.visibility === "private" && this.isAvailableForAnyExchange();
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

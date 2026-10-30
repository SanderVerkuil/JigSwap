export interface Availability {
  forTrade: boolean;
  forLend: boolean;
  forSale: boolean;
}

export const hasAnyAvailability = (a: Availability): boolean =>
  a.forTrade || a.forLend || a.forSale;

// Shape matches gateway.library.updateSharing args. `visibility` is the owner's own choice (default
// visible), sent as is: a private copy stays private underneath while offered (the backend shows it
// only while an offer is on) and is private again once every offer is withdrawn.
export const availabilityToSharing = (
  copyId: string,
  a: Availability,
  visibility: "private" | "visible" = "visible",
) => ({
  copyId,
  visibility,
  forTrade: a.forTrade,
  forLend: a.forLend,
  forSale: a.forSale,
});

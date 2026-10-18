export interface Availability {
  forTrade: boolean;
  forLend: boolean;
  forSale: boolean;
}

export const hasAnyAvailability = (a: Availability): boolean =>
  a.forTrade || a.forLend || a.forSale;

// Shape matches gateway.library.updateSharing args. `visibility` is the owner's choice (default
// visible); any offer forces "visible", since the backend rejects a private copy that is offered.
export const availabilityToSharing = (
  copyId: string,
  a: Availability,
  visibility: "private" | "visible" = "visible",
) => ({
  copyId,
  visibility: hasAnyAvailability(a) ? ("visible" as const) : visibility,
  forTrade: a.forTrade,
  forLend: a.forLend,
  forSale: a.forSale,
});

export interface Availability {
  forTrade: boolean;
  forLend: boolean;
  forSale: boolean;
}

export const hasAnyAvailability = (a: Availability): boolean =>
  a.forTrade || a.forLend || a.forSale;

// Shape matches gateway.library.updateSharing args.
export const availabilityToSharing = (copyId: string, a: Availability) => ({
  copyId,
  visibility: "visible" as const,
  forTrade: a.forTrade,
  forLend: a.forLend,
  forSale: a.forSale,
});

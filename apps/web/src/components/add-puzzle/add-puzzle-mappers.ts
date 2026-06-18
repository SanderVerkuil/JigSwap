export interface Availability {
  forTrade: boolean;
  forLend: boolean;
  forSale: boolean;
}

export const hasAnyAvailability = (a: Availability): boolean =>
  a.forTrade || a.forLend || a.forSale;

// The catalog id used to acquire a copy. Domain-written puzzles carry an `aggregateId`;
// legacy/seeded rows predate it (it is optional in the schema) and must fall back to the raw
// Convex `_id`, which the acquireCopy backend resolves via its by-_id fallback. Without this
// fallback a legacy puzzle leaves `selectedDefinitionId` null — Save stays disabled and, worse,
// a submit would mint a duplicate catalog definition instead of reusing the existing one.
export const resolveDefinitionId = (
  aggregateId: string | null | undefined,
  fallbackId: string | null | undefined,
): string | null => aggregateId ?? fallbackId ?? null;

// Shape matches gateway.library.updateSharing args.
export const availabilityToSharing = (copyId: string, a: Availability) => ({
  copyId,
  visibility: "visible" as const,
  forTrade: a.forTrade,
  forLend: a.forLend,
  forSale: a.forSale,
});

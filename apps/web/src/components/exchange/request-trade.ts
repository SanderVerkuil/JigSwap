import { ConvexError } from "convex/values";

// Pure helpers for the trade-request dialog: which exchange types a copy allows, whether the
// viewer may request it at all, and how propose's stable error codes map to localized messages.

/** The `type` values `gateway.exchange.create` (propose) accepts. */
export type ProposeType = "trade" | "sale" | "loan";

export interface Availability {
  forTrade: boolean;
  forSale: boolean;
  forLend: boolean;
}

/** The propose types a copy is offered for, mirroring propose's swap⇒forTrade, sale⇒forSale, lend⇒forLend. */
export const allowedProposeTypes = (
  availability: Availability,
): ProposeType[] => [
  ...(availability.forTrade ? (["trade"] as const) : []),
  ...(availability.forSale ? (["sale"] as const) : []),
  ...(availability.forLend ? (["loan"] as const) : []),
];

/**
 * Whether to offer "Request trade": a known viewer who isn't the owner, on an available copy, and
 * the server says the viewer may request it (`viewerMayRequest` is false when their only route is
 * a view-only circle seat). An absent `ownerId` means the owner is anonymous to the viewer, so
 * never the viewer themselves.
 */
export const canRequestTrade = (
  copy: {
    ownerId?: string;
    availability: Availability;
    viewerMayRequest?: boolean;
  },
  viewerId: string | undefined,
): boolean =>
  viewerId !== undefined &&
  copy.ownerId !== viewerId &&
  copy.viewerMayRequest !== false &&
  allowedProposeTypes(copy.availability).length > 0;

/** Message keys under `tradeRequest.errors`. */
export type ProposeErrorKey =
  | "notAvailable"
  | "notFound"
  | "notReachable"
  | "viewOnly"
  | "offeredNotOwned"
  | "duplicate"
  | "ownCopy"
  | "missingTerms"
  | "generic";

const CODE_TO_KEY: Record<string, ProposeErrorKey> = {
  CopyNotAvailable: "notAvailable",
  CopyNotFound: "notFound",
  CopyNotReachable: "notReachable",
  NotPermittedInCircle: "viewOnly",
  // The copy changed hands since the page loaded — to the requester it reads as "gone".
  RecipientNotOwner: "notFound",
  OfferedCopyNotOwned: "offeredNotOwned",
  DuplicateProposal: "duplicate",
  SelfExchange: "ownCopy",
  MissingTerms: "missingTerms",
};

/** The stable `code` of a ConvexError (its data may arrive JSON-encoded), else undefined. */
export const convexErrorCode = (error: unknown): string | undefined => {
  if (!(error instanceof ConvexError)) return undefined;
  let data: unknown = error.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  return typeof data === "object" && data !== null && "code" in data
    ? String((data as { code: unknown }).code)
    : undefined;
};

/** Map a propose failure to its localized message key; unknown failures are "generic". */
export const proposeErrorKey = (error: unknown): ProposeErrorKey =>
  CODE_TO_KEY[convexErrorCode(error) ?? ""] ?? "generic";

/** Parse a euro amount ("12", "12.5", "12,99") into positive integer cents, else undefined. */
export const parsePriceCents = (input: string): number | undefined => {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return undefined;
  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents > 0 ? cents : undefined;
};

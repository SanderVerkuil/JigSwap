import { convexErrorCode } from "@/lib/convex-error-code";
import { ArrowLeftRight, Package, Tag, type LucideIcon } from "lucide-react";

// Re-exported so modules that import the helper from here keep compiling; the helper itself lives
// in lib/convex-error-code.ts. Keep this until no module imports it from this path.
export { convexErrorCode } from "@/lib/convex-error-code";

// Pure helpers for the trade-request dialog: which exchange types a copy allows, whether the
// viewer may request it at all, what its request button says, and how propose's stable error
// codes map to localized messages.

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

/** Message keys under `tradeRequest.cta`: what a copy's request button offers. */
export type RequestActionKey = "borrow" | "swap" | "buy" | "mixed";

const SINGLE_ACTION: Record<ProposeType, RequestActionKey> = {
  trade: "swap",
  sale: "buy",
  loan: "borrow",
};

/**
 * The request button's wording, from what the copy is offered for: one kind names it ("Ask to
 * borrow" for a lend-only copy), several ask generically ("Request…") and the dialog then lets the
 * requester pick. Every request button (copy page, Browse card) should use this, so a lend-only
 * copy never says "Request swap". A copy offered for nothing has no request button
 * (canRequestTrade), so its "mixed" is never shown.
 */
export const requestActionKey = (
  availability: Availability,
): RequestActionKey => {
  const types = allowedProposeTypes(availability);
  return types.length === 1 ? SINGLE_ACTION[types[0]] : "mixed";
};

/** The request button's icon per action, matching the exchange kind icons on /trades. */
export const REQUEST_ACTION_ICONS: Record<RequestActionKey, LucideIcon> = {
  borrow: Package,
  swap: ArrowLeftRight,
  buy: Tag,
  mixed: ArrowLeftRight,
};

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
  | "rateLimited"
  | "generic";

const CODE_TO_KEY: Record<string, ProposeErrorKey> = {
  CopyNotAvailable: "notAvailable",
  CopyNotFound: "notFound",
  CopyNotReachable: "notReachable",
  NotPermittedInCircle: "viewOnly",
  // The copy changed hands since the page loaded — to the requester it reads as "gone".
  RecipientNotOwner: "notFound",
  OfferedCopyNotOwned: "offeredNotOwned",
  // Propose answers this only for the offered copy, when it is out on loan (a lent-out requested
  // copy is CopyNotAvailable): it can't be offered until it is back.
  CopyReserved: "offeredNotOwned",
  DuplicateProposal: "duplicate",
  SelfExchange: "ownCopy",
  MissingTerms: "missingTerms",
  // Too many requests lately: an hourly or daily cap, or the weekly cap per owner.
  RateLimited: "rateLimited",
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

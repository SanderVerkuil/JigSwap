import {
  type CopyId,
  Exchange,
  type ExchangeKind,
  type ExchangeState,
  type ExchangeStatus,
  type LegacyExchangeKind,
  type MemberId,
  Money,
  toId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";

// ACL between the persisted `exchanges` row and the Exchange aggregate. Schema changes stop
// here and never ripple into the domain.

// kind <-> legacy `type` column (swap<->trade, sale<->sale, lend<->loan).
const KIND_TO_TYPE: Record<ExchangeKind, LegacyExchangeKind> = {
  swap: "trade",
  sale: "sale",
  lend: "loan",
};
const TYPE_TO_KIND: Record<LegacyExchangeKind, ExchangeKind> = {
  trade: "swap",
  sale: "sale",
  loan: "lend",
};

// The insert/patch payload (the row minus Convex-managed `_id`/`_creationTime`).
export type ExchangeRow = Omit<Doc<"exchanges">, "_id" | "_creationTime">;

// Row -> aggregate. The row MUST carry an aggregateId (only domain-written rows do); callers
// guard for it before mapping.
export const toDomain = (row: Doc<"exchanges">): Exchange => {
  const kind = TYPE_TO_KIND[row.type];
  const base = {
    id: toId<"ExchangeId">(row.aggregateId as string),
    initiatorId: toId<"MemberId">(row.initiatorId) as MemberId,
    recipientId: toId<"MemberId">(row.recipientId) as MemberId,
    requestedCopyId: toId<"CopyId">(row.requestedPuzzleId) as CopyId,
    status: row.status as ExchangeStatus,
    initiatorConfirmationTimestamp: toDate(row.initiatorConfirmationTimestamp),
    recipientConfirmationTimestamp: toDate(row.recipientConfirmationTimestamp),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };

  let state: ExchangeState;
  switch (kind) {
    case "swap":
      state = {
        ...base,
        kind: "swap",
        offeredCopyId: row.offeredPuzzleId
          ? (toId<"CopyId">(row.offeredPuzzleId) as CopyId)
          : undefined,
      };
      break;
    case "sale": {
      // salePrice.amount carries minor units (cents); the column has a currency too.
      const price = row.salePrice
        ? Money.create(row.salePrice.amount, row.salePrice.currency)
        : undefined;
      state = {
        ...base,
        kind: "sale",
        price: price && price.isOk ? price.value : undefined,
      };
      break;
    }
    case "lend":
      state = {
        ...base,
        kind: "lend",
        returnDate: toDate(row.loanReturnDate),
      };
      break;
  }
  return Exchange.rehydrate(state);
};

// Aggregate -> row payload. Domain ExchangeId becomes `aggregateId`; foreign id strings are
// re-branded to Convex Ids for the columns.
export const toRow = (exchange: Exchange): ExchangeRow => {
  const state = exchange.toState();
  return {
    aggregateId: state.id as string,
    initiatorId: state.initiatorId as unknown as Id<"users">,
    recipientId: state.recipientId as unknown as Id<"users">,
    type: KIND_TO_TYPE[state.kind],
    offeredPuzzleId: state.offeredCopyId
      ? (state.offeredCopyId as unknown as Id<"ownedPuzzles">)
      : undefined,
    requestedPuzzleId: state.requestedCopyId as unknown as Id<"ownedPuzzles">,
    // No currency column for sale was a worry, but `salePrice` carries one; store cents+currency.
    salePrice: state.price
      ? { amount: state.price.amountCents, currency: state.price.currency }
      : undefined,
    loanReturnDate: state.returnDate ? state.returnDate.getTime() : undefined,
    status: state.status,
    initiatorConfirmationTimestamp: state.initiatorConfirmationTimestamp?.getTime(),
    recipientConfirmationTimestamp: state.recipientConfirmationTimestamp?.getTime(),
    createdAt: state.createdAt.getTime(),
    updatedAt: state.updatedAt.getTime(),
  };
};

const toDate = (ms: number | undefined): Date | undefined =>
  ms === undefined ? undefined : new Date(ms);

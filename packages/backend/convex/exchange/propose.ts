import {
  type ExchangeKind,
  type ExchangeTermsInput,
  makeProposeExchange,
  Money,
  toCopyId,
  toMemberId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCopyPort } from "./adapters/convexCopyPort";
import { convexExchangeRepository } from "./adapters/convexExchangeRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { uuidExchangeIdGenerator } from "./adapters/uuidExchangeId";
import { toConvexError } from "./errors";

const TYPE_TO_KIND = { trade: "swap", sale: "sale", loan: "lend" } as const;
const DEFAULT_CURRENCY = "EUR";

// Composition root for proposing an exchange: authenticate -> wire adapters -> call the use
// case -> map result. All behaviour lives in the (Convex-free) domain/application layers.
export const propose = mutation({
  args: {
    recipientId: v.id("users"),
    type: v.union(v.literal("trade"), v.literal("sale"), v.literal("loan")),
    offeredPuzzleId: v.optional(v.id("ownedPuzzles")),
    requestedPuzzleId: v.id("ownedPuzzles"),
    salePrice: v.optional(v.number()),
    loanReturnDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const initiatorId = await requireMember(ctx); // initiator derived from auth, never the client

    const kind: ExchangeKind = TYPE_TO_KIND[args.type];
    const terms = buildTerms(kind, args);
    if (terms instanceof ConvexError) throw terms;

    const proposeExchange = makeProposeExchange({
      exchanges: convexExchangeRepository(ctx),
      copies: convexCopyPort(ctx),
      ids: uuidExchangeIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await proposeExchange({
      initiatorId,
      recipientId: toMemberId(args.recipientId),
      kind,
      requestedCopyId: toCopyId(args.requestedPuzzleId),
      terms,
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});

// Build the kind-tagged terms from the legacy-shaped args. Orphan fields (message,
// proposedExchangeDate, shippingMethod) are intentionally dropped in this slice.
const buildTerms = (
  kind: ExchangeKind,
  args: {
    offeredPuzzleId?: string;
    salePrice?: number;
    loanReturnDate?: number;
  },
): ExchangeTermsInput | ConvexError<{ code: string; message: string }> => {
  switch (kind) {
    case "swap":
      return {
        kind: "swap",
        offeredCopyId: args.offeredPuzzleId
          ? toCopyId(args.offeredPuzzleId)
          : undefined,
      };
    case "sale": {
      if (args.salePrice === undefined)
        return { kind: "sale", price: undefined };
      const money = Money.create(args.salePrice, DEFAULT_CURRENCY);
      if (money.isErr) return toConvexError(money.error);
      return { kind: "sale", price: money.value };
    }
    case "lend":
      return {
        kind: "lend",
        returnDate: args.loanReturnDate
          ? new Date(args.loanReturnDate)
          : undefined,
      };
  }
};

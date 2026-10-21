import {
  ApplicationError,
  makeProposeExchange,
  Money,
  toCopyId,
  toMemberId,
  type ExchangeKind,
  type ExchangeTermsInput,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { canViewCopy } from "../library/canViewCopy";
import { assertPairNotBlocked } from "../social/blocks";
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
//
// The recipient is ALWAYS the requested copy's current owner, read server-side. `recipientId` is
// DEPRECATED and IGNORED: it stays in the validator (optional) only because older clients still
// send it and Convex rejects unknown args. It must never influence the outcome — honouring it
// would make propose an ownership oracle (a wrong guess erroring differently from a right one
// lets a requester confirm a hidden owner's id, then read their locked profile hero by id).
export const propose = mutation({
  args: {
    recipientId: v.optional(v.id("users")), // deprecated, ignored (see above)
    type: v.union(v.literal("trade"), v.literal("sale"), v.literal("loan")),
    offeredPuzzleId: v.optional(v.id("ownedPuzzles")),
    requestedPuzzleId: v.id("ownedPuzzles"),
    salePrice: v.optional(v.number()),
    loanReturnDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const initiatorId = await requireMember(ctx); // initiator derived from auth, never the client

    const requested = await ctx.db.get(args.requestedPuzzleId);
    if (requested === null) {
      throw new ConvexError({
        code: "CopyNotFound",
        message: `Copy ${args.requestedPuzzleId} could not be found`,
      });
    }
    const recipientId = requested.ownerId;
    // Against the derived owner, never the ignored client `recipientId`.
    await assertPairNotBlocked(ctx, initiatorId, recipientId);
    // Reachability: the initiator may only propose on a copy they could see (the same gate every
    // copy read uses). Without it any member who learns a copy id could target an owner they have
    // no route to (private profile, no shared circle, not friends).
    if (
      !(await canViewCopy(
        ctx,
        initiatorId as unknown as Id<"users">,
        requested,
      ))
    ) {
      throw toConvexError(
        ApplicationError.copyNotReachable(toCopyId(args.requestedPuzzleId)),
      );
    }

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
      recipientId: toMemberId(recipientId),
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

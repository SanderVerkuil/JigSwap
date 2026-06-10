import {
  type ApplicationError,
  type ExchangeActionDeps,
  type ExchangeError,
  type ExchangeId,
  type MemberId,
  type Result,
  toExchangeId,
} from "@jigswap/domain";
import type { MutationCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexExchangeRepository } from "./adapters/convexExchangeRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

type ActionUseCase = (cmd: {
  exchangeId: ExchangeId;
  actingMemberId: MemberId;
}) => Promise<Result<void, ExchangeError | ApplicationError>>;

// Shared composition root for the lifecycle mutations: authenticate, wire adapters, invoke the
// use case factory, map the result. Keeps each mutation file a one-liner over its use case.
export const runAction = async (
  ctx: MutationCtx,
  exchangeId: string,
  make: (deps: ExchangeActionDeps) => ActionUseCase,
): Promise<void> => {
  const actingMemberId = await requireMember(ctx);
  const action = make({
    exchanges: convexExchangeRepository(ctx),
    events: inProcessEventPublisher(ctx),
    clock: systemClock,
  });
  const result = await action({
    exchangeId: toExchangeId(exchangeId),
    actingMemberId,
  });
  if (result.isErr) throw toConvexError(result.error);
};

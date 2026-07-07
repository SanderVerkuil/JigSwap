import { DomainError } from "../../shared-kernel";
import { ExchangeKind } from "./exchange-kind";
import { ExchangeStatus } from "./exchange-status";

// A closed set of reasons an Exchange operation can fail. The `code` is the stable,
// machine-readable discriminant a transport adapter maps to (the human message is for
// logs/tests only). Modelled as a DomainError subclass so it can be thrown or carried
// in a Result interchangeably.
export type ExchangeErrorCode =
  "SelfExchange" | "MissingTerms" | "IllegalTransition" | "WrongParty";

export class ExchangeError extends DomainError {
  override readonly name = "ExchangeError";

  private constructor(
    readonly code: ExchangeErrorCode,
    message: string,
  ) {
    super(message);
  }

  // An exchange cannot be both sides of itself.
  static selfExchange(): ExchangeError {
    return new ExchangeError(
      "SelfExchange",
      "Initiator and recipient must be different members",
    );
  }

  // Kind-specific terms were absent or invalid at construction.
  static missingTerms(kind: ExchangeKind, detail: string): ExchangeError {
    return new ExchangeError(
      "MissingTerms",
      `Invalid terms for ${kind}: ${detail}`,
    );
  }

  // The requested status move is not allowed from the current status.
  static illegalTransition(
    from: ExchangeStatus,
    to: ExchangeStatus,
  ): ExchangeError {
    return new ExchangeError(
      "IllegalTransition",
      `Cannot transition from ${from} to ${to}`,
    );
  }

  // The acting member is not authorised to perform this action.
  static wrongParty(action: string): ExchangeError {
    return new ExchangeError("WrongParty", `Acting member may not ${action}`);
  }
}

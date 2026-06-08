import { DomainError } from "../../shared-kernel";
import { CopyId, ExchangeId } from "../domain";
import { ExchangeKind } from "../domain";

// Orchestration-level failures the aggregate cannot express because they depend on the
// world (other aggregates' state) rather than the Exchange's own data. Like ExchangeError,
// the `code` is the stable, machine-readable discriminant a transport adapter maps to;
// the message is for logs/tests only.
export type ApplicationErrorCode =
  | "CopyNotFound"
  | "CopyNotAvailable"
  | "OfferedCopyNotOwned"
  | "DuplicateProposal"
  | "ExchangeNotFound";

export class ApplicationError extends DomainError {
  override readonly name = "ApplicationError";

  private constructor(
    readonly code: ApplicationErrorCode,
    message: string,
  ) {
    super(message);
  }

  // A referenced copy does not exist in the Library.
  static copyNotFound(copyId: CopyId): ApplicationError {
    return new ApplicationError("CopyNotFound", `Copy ${copyId} could not be found`);
  }

  // The requested copy is not offered for the proposed kind (swap/sale/lend).
  static copyNotAvailable(copyId: CopyId, kind: ExchangeKind): ApplicationError {
    return new ApplicationError(
      "CopyNotAvailable",
      `Copy ${copyId} is not available for ${kind}`,
    );
  }

  // For a swap, the offered copy must belong to the initiator.
  static offeredCopyNotOwned(copyId: CopyId): ApplicationError {
    return new ApplicationError(
      "OfferedCopyNotOwned",
      `Offered copy ${copyId} is not owned by the initiator`,
    );
  }

  // The initiator already has an active proposed exchange for this requested copy.
  static duplicateProposal(copyId: CopyId): ApplicationError {
    return new ApplicationError(
      "DuplicateProposal",
      `An active proposal already exists for copy ${copyId}`,
    );
  }

  // No exchange exists for the given id.
  static exchangeNotFound(exchangeId: ExchangeId): ApplicationError {
    return new ApplicationError(
      "ExchangeNotFound",
      `Exchange ${exchangeId} could not be found`,
    );
  }
}

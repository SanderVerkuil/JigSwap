import { Result } from "../../../../shared-kernel";
import {
  CopyId,
  ExchangeError,
  ExchangeId,
  ExchangeKind,
  ExchangeTermsInput,
  MemberId,
} from "../../../domain";
import { ApplicationError } from "../../errors";

// The command to propose an exchange. `initiatorId` is resolved from auth by the transport
// adapter; the kind-tagged `terms` carry the offered copy / price / return date.
export interface ProposeExchangeCommand {
  readonly initiatorId: MemberId;
  readonly recipientId: MemberId;
  readonly kind: ExchangeKind;
  readonly requestedCopyId: CopyId;
  readonly terms: ExchangeTermsInput;
}

// Inbound port: the propose-exchange use case.
export interface ProposeExchange {
  (
    cmd: ProposeExchangeCommand,
  ): Promise<Result<ExchangeId, ExchangeError | ApplicationError>>;
}

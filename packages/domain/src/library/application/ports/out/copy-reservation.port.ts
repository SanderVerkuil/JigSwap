import { CopyId } from "../../../domain";

// Outbound port modelling the cross-context seam to Exchange: "a copy cannot be marked
// available while RESERVED by an active Exchange" (§1.4). Reservation state lives in the
// Exchange context, so the Library asks through this port rather than knowing about exchanges.
// The real adapter (2c / Exchange reconciliation) answers from active-exchange state; the
// invariant itself is enforced in the UpdateCopySharing use case, not in the aggregate.
export interface CopyReservationPort {
  isReserved(copyId: CopyId): Promise<boolean>;
}

import { CopyId } from "../../domain";
import { CopyReservationPort } from "../ports/out/copy-reservation.port";

// In-memory CopyReservationPort. Defaults to "nothing reserved"; tests mark specific copies
// reserved via `reserve` to exercise the "cannot make available while reserved" rule.
export class FakeCopyReservationPort implements CopyReservationPort {
  private readonly reserved = new Set<CopyId>();

  reserve(copyId: CopyId): this {
    this.reserved.add(copyId);
    return this;
  }

  async isReserved(copyId: CopyId): Promise<boolean> {
    return this.reserved.has(copyId);
  }
}

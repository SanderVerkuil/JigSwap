import { CopyId } from "../../domain";
import { CopyPort, CopyView } from "../ports/out/copy.port";

// Seedable in-memory CopyPort. Tests register copies via `seed`; unknown copies read as null.
export class FakeCopyPort implements CopyPort {
  private readonly copies = new Map<CopyId, CopyView>();

  seed(copy: CopyView): this {
    this.copies.set(copy.id, copy);
    return this;
  }

  async getCopy(copyId: CopyId): Promise<CopyView | null> {
    return this.copies.get(copyId) ?? null;
  }
}

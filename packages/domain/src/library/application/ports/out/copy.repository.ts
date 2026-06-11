import { Copy, CopyId, OwnerId } from "../../../domain";

// Outbound port: persistence for the Copy aggregate. The 2c-convex adapter implements this
// over `ctx.db` (the `ownedPuzzles` table) behind a mapper; the domain never sees a row.
export interface CopyRepository {
  findById(id: CopyId): Promise<Copy | null>;
  save(copy: Copy): Promise<void>;
  remove(id: CopyId): Promise<void>;
  listByOwner(ownerId: OwnerId): Promise<readonly Copy[]>;
}

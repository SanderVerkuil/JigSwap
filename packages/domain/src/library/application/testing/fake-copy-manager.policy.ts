import { CopyId, OwnerId } from "../../domain";
import { CopyManagerPolicy } from "../ports/out/copy-manager.policy";

// Test double: only the (copy, actor) pairs explicitly allowed may manage.
export class FakeCopyManagerPolicy implements CopyManagerPolicy {
  private readonly allowed = new Set<string>();

  allow(copyId: CopyId, actorId: OwnerId): void {
    this.allowed.add(`${copyId}|${actorId}`);
  }

  async canManage(
    copy: { readonly id: CopyId; readonly ownerId: OwnerId },
    actorId: OwnerId,
  ): Promise<boolean> {
    return this.allowed.has(`${copy.id}|${actorId}`);
  }
}

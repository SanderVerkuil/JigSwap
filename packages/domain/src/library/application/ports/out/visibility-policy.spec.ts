import { describe, expect, it } from "vitest";
import { toId } from "../../../../shared-kernel";
import {
  CatalogSnapshot,
  Copy,
  CopyId,
  OwnerId,
  PuzzleDefinitionId,
  SharingSetting,
} from "../../../domain";
import { DefaultVisibilityPolicy } from "./visibility-policy";

const owner = toId<"OwnerId">("alice") as OwnerId;
const viewer = toId<"OwnerId">("bob") as OwnerId;
const definitionId = toId<"PuzzleDefinitionId">("def1") as PuzzleDefinitionId;
const NOW = new Date("2026-06-08T10:00:00Z");

const copyWith = (sharing: SharingSetting): Copy => {
  const acquired = Copy.acquire({
    id: toId<"CopyId">("copy1") as CopyId,
    ownerId: owner,
    snapshot: CatalogSnapshot.create({
      puzzleDefinitionId: definitionId,
      title: "Bridge",
      pieceCount: 750,
    }),
    condition: "good",
    now: NOW,
  });
  if (!acquired.isOk) throw new Error("setup");
  acquired.value.updateSharing(sharing, NOW);
  return acquired.value;
};

describe("DefaultVisibilityPolicy", () => {
  const policy = new DefaultVisibilityPolicy();

  it("the owner can always view but cannot transact with themselves", () => {
    const copy = copyWith(
      SharingSetting.create({ visibility: "visible", forTrade: true }),
    );
    expect(policy.canView(owner, copy)).toBe(true);
    expect(policy.canTransact(owner, copy)).toBe(false);
  });

  it("a stranger cannot view a private, non-offered copy", () => {
    const copy = copyWith(SharingSetting.private());
    expect(policy.canView(viewer, copy)).toBe(false);
    expect(policy.canTransact(viewer, copy)).toBe(false);
  });

  it("a stranger can view a public copy but cannot transact when no kind is offered", () => {
    const copy = copyWith(SharingSetting.create({ visibility: "visible" }));
    expect(policy.canView(viewer, copy)).toBe(true);
    expect(policy.canTransact(viewer, copy)).toBe(false);
  });

  it("a stranger can view and transact on a copy offered for exchange", () => {
    const copy = copyWith(
      SharingSetting.create({ visibility: "private", forSale: true }),
    );
    expect(policy.canView(viewer, copy)).toBe(true);
    expect(policy.canTransact(viewer, copy)).toBe(true);
  });
});

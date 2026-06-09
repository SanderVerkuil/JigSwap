import { describe, expect, it } from "vitest";
import { DomainEvent, toId } from "../../shared-kernel";
import { Collection } from "./collection";
import { CollectionId, CopyId, OwnerId, PuzzleDefinitionId } from "./ids";

const collectionId = toId<"CollectionId">("col1") as CollectionId;
const owner = toId<"OwnerId">("alice") as OwnerId;
const copyA = toId<"CopyId">("copyA") as CopyId;
const copyB = toId<"CopyId">("copyB") as CopyId;
const definitionId = toId<"PuzzleDefinitionId">("def1") as PuzzleDefinitionId;
const NOW = new Date("2026-06-08T10:00:00Z");

const create = (
  over: Partial<Parameters<typeof Collection.create>[0]> = {},
): Collection => {
  const result = Collection.create({
    id: collectionId,
    ownerId: owner,
    name: "Favorites",
    now: NOW,
    ...over,
  });
  if (!result.isOk) throw new Error("setup failed");
  return result.value;
};

const names = (events: readonly DomainEvent[]): string[] =>
  events.map((e) => e.name);

describe("Collection.create", () => {
  it("starts empty, private, and records CollectionCreated", () => {
    const collection = create();
    expect(collection.toState().visibility).toBe("private");
    expect(collection.copyMembers).toEqual([]);
    expect(names(collection.pullEvents())).toEqual(["CollectionCreated"]);
  });

  it("defaults isDefault and isWishlist to false, honouring explicit flags", () => {
    const plain = create();
    expect(plain.isDefault).toBe(false);
    expect(plain.isWishlist).toBe(false);

    const flagged = create({ isDefault: true, isWishlist: true });
    expect(flagged.isDefault).toBe(true);
    expect(flagged.isWishlist).toBe(true);
  });
});

describe("update", () => {
  // Each field patches via `props.X ?? state.X`; setting one from an unset/default baseline
  // distinguishes `??` from `&&` (which would drop the new value).
  it("applies provided fields and records CollectionUpdated", () => {
    const collection = create();
    collection.pullEvents();
    const r = collection.update(
      {
        name: "Renamed",
        description: "A description",
        visibility: "public",
        color: "#fff",
        icon: "star",
        personalNotes: "mine",
      },
      NOW,
    );
    expect(r.isOk).toBe(true);
    const state = collection.toState();
    expect(state.name).toBe("Renamed");
    expect(state.description).toBe("A description");
    expect(state.visibility).toBe("public");
    expect(state.color).toBe("#fff");
    expect(state.icon).toBe("star");
    expect(state.personalNotes).toBe("mine");
    expect(names(collection.pullEvents())).toEqual(["CollectionUpdated"]);
  });

  it("leaves omitted fields unchanged", () => {
    const collection = create({ name: "Keep", visibility: "public" });
    collection.update({ description: "only this" }, NOW);
    const state = collection.toState();
    expect(state.name).toBe("Keep");
    expect(state.visibility).toBe("public");
    expect(state.description).toBe("only this");
  });
});

describe("addCopy / removeCopy", () => {
  it("adds copies and records CopyAddedToCollection", () => {
    const collection = create();
    collection.pullEvents();
    collection.addCopy(copyA, NOW);
    expect(collection.copyMembers).toEqual([copyA]);
    expect(names(collection.pullEvents())).toEqual(["CopyAddedToCollection"]);
  });

  it("de-duplicates a repeated add (no second event)", () => {
    const collection = create();
    collection.addCopy(copyA, NOW);
    collection.pullEvents();
    collection.addCopy(copyA, NOW);
    expect(collection.copyMembers).toEqual([copyA]);
    expect(collection.pullEvents()).toHaveLength(0);
  });

  it("removes a member and records CopyRemovedFromCollection", () => {
    const collection = create();
    collection.addCopy(copyA, NOW);
    collection.addCopy(copyB, NOW);
    collection.pullEvents();
    const r = collection.removeCopy(copyA, NOW);
    expect(r.isOk).toBe(true);
    expect(collection.copyMembers).toEqual([copyB]);
    expect(names(collection.pullEvents())).toEqual([
      "CopyRemovedFromCollection",
    ]);
  });

  it("rejects removing a copy that is not a member", () => {
    const collection = create();
    const r = collection.removeCopy(copyA, NOW);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("CopyNotInCollection");
  });

  it("rejects adding a copy to a wishlist (wrong member type)", () => {
    const wishlist = create({ isWishlist: true });
    const r = wishlist.addCopy(copyA, NOW);
    expect(r.isErr).toBe(true);
    if (r.isErr) {
      expect(r.error.code).toBe("WrongMemberType");
      expect(r.error.message).toBe(
        "A wishlist holds desired definitions, not copies",
      );
    }
  });
});

describe("wishlist behavior", () => {
  it("a wishlist references desired definitions, not copies, and emits PuzzleWished", () => {
    const wishlist = create({ isWishlist: true });
    wishlist.pullEvents();
    const r = wishlist.wishFor(definitionId, NOW);
    expect(r.isOk).toBe(true);
    expect(wishlist.wishedDefinitions).toEqual([definitionId]);
    expect(names(wishlist.pullEvents())).toEqual(["PuzzleWished"]);
  });

  it("rejects wishing on a non-wishlist collection", () => {
    const collection = create();
    const r = collection.wishFor(definitionId, NOW);
    expect(r.isErr).toBe(true);
    if (r.isErr) {
      expect(r.error.code).toBe("WrongMemberType");
      expect(r.error.message).toBe(
        "Only a wishlist can reference desired definitions",
      );
    }
  });

  it("de-duplicates a repeated wish (no second event)", () => {
    const wishlist = create({ isWishlist: true });
    wishlist.wishFor(definitionId, NOW);
    wishlist.pullEvents();
    const r = wishlist.wishFor(definitionId, NOW);
    expect(r.isOk).toBe(true);
    expect(wishlist.wishedDefinitions).toEqual([definitionId]);
    expect(wishlist.pullEvents()).toHaveLength(0);
  });

  it("unwishes a desired definition while keeping the others", () => {
    const other = toId<"PuzzleDefinitionId">("def2") as PuzzleDefinitionId;
    const wishlist = create({ isWishlist: true });
    wishlist.wishFor(definitionId, NOW);
    wishlist.wishFor(other, NOW);
    wishlist.pullEvents();
    const r = wishlist.unwish(definitionId, NOW);
    expect(r.isOk).toBe(true);
    expect(wishlist.wishedDefinitions).toEqual([other]);
    expect(names(wishlist.pullEvents())).toEqual(["PuzzleUnwished"]);
  });

  it("rejects unwishing a definition that is not wished", () => {
    const wishlist = create({ isWishlist: true });
    const r = wishlist.unwish(definitionId, NOW);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("CopyNotInCollection");
  });
});

describe("delete (default-collection guard)", () => {
  it("deletes a non-default collection and records CollectionDeleted", () => {
    const collection = create();
    collection.pullEvents();
    const r = collection.delete(NOW);
    expect(r.isOk).toBe(true);
    expect(names(collection.pullEvents())).toEqual(["CollectionDeleted"]);
  });

  it("refuses to delete a default collection", () => {
    const collection = create({ isDefault: true });
    const r = collection.delete(NOW);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("CannotDeleteDefaultCollection");
  });
});

describe("rehydrate / toState round-trip", () => {
  it("rehydrates without re-recording events", () => {
    const original = create();
    original.addCopy(copyA, NOW);
    const state = original.toState();
    const restored = Collection.rehydrate(state);
    expect(restored.pullEvents()).toHaveLength(0);
    expect(restored.toState()).toEqual(state);
  });
});

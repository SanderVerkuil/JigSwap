import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  toCollectionId,
  toCopyId,
  toOwnerId,
  toPuzzleDefinitionId,
} from "../../../shared-kernel";
import {
  CatalogSnapshot,
  Collection,
  CollectionId,
  Copy,
  CopyId,
  OwnerId,
} from "../../domain";
import {
  FixedClock,
  InMemoryCollectionRepository,
  InMemoryCopyRepository,
  RecordingEventPublisher,
  SequentialCollectionIdGenerator,
} from "../testing";
import { makeAddCopyToCollection } from "./add-copy-to-collection";
import { makeCreateCollection } from "./create-collection";
import { makeDeleteCollection } from "./delete-collection";
import { makeRemoveCopyFromCollection } from "./remove-copy-from-collection";
import { makeUpdateCollection } from "./update-collection";

const alice = toOwnerId("alice");
const bob = toOwnerId("bob");
const definitionId = toPuzzleDefinitionId("def1");
const NOW = new Date("2026-06-08T10:00:00Z");

const snapshot = (): CatalogSnapshot =>
  CatalogSnapshot.create({
    puzzleDefinitionId: definitionId,
    title: "Cat",
    pieceCount: 300,
  });

// Persist a copy owned by `owner` and return its id.
const seedCopy = async (
  copies: InMemoryCopyRepository,
  owner: OwnerId,
  id: string,
): Promise<CopyId> => {
  const acquired = Copy.acquire({
    id: toCopyId(id),
    ownerId: owner,
    snapshot: snapshot(),
    condition: "good",
    now: NOW,
  });
  if (!acquired.isOk) throw new Error("setup");
  await copies.save(acquired.value);
  return acquired.value.id;
};

describe("makeCreateCollection", () => {
  let collections: InMemoryCollectionRepository;
  let events: RecordingEventPublisher;
  let ids: SequentialCollectionIdGenerator;

  const run = () =>
    makeCreateCollection({
      collections,
      ids,
      events,
      clock: new FixedClock(NOW),
    });

  beforeEach(() => {
    collections = new InMemoryCollectionRepository();
    events = new RecordingEventPublisher();
    ids = new SequentialCollectionIdGenerator(); // one generator → unique ids across calls
  });

  it("creates a collection and publishes CollectionCreated", async () => {
    const result = await run()({ ownerId: alice, name: "Favorites" });
    expect(result.isOk).toBe(true);
    expect(collections.size()).toBe(1);
    expect(events.names()).toEqual(["CollectionCreated"]);
  });

  it("rejects a duplicate name for the same owner", async () => {
    await run()({ ownerId: alice, name: "Favorites" });
    const second = await run()({ ownerId: alice, name: "Favorites" });
    expect(second.isErr).toBe(true);
    if (second.isErr) expect(second.error.code).toBe("DuplicateCollectionName");
    expect(collections.size()).toBe(1);
  });

  it("allows the same name for a different owner", async () => {
    await run()({ ownerId: alice, name: "Favorites" });
    const second = await run()({ ownerId: bob, name: "Favorites" });
    expect(second.isOk).toBe(true);
    expect(collections.size()).toBe(2);
  });
});

describe("collection membership use cases", () => {
  let collections: InMemoryCollectionRepository;
  let copies: InMemoryCopyRepository;
  let events: RecordingEventPublisher;
  let collectionId: CollectionId;

  const seedCollection = async (owner: OwnerId, over = {}) => {
    const created = Collection.create({
      id: toCollectionId("col-seed"),
      ownerId: owner,
      name: "My Shelf",
      now: NOW,
      ...over,
    });
    if (!created.isOk) throw new Error("setup");
    await collections.save(created.value);
    return created.value.id;
  };

  beforeEach(async () => {
    collections = new InMemoryCollectionRepository();
    copies = new InMemoryCopyRepository();
    events = new RecordingEventPublisher();
    collectionId = await seedCollection(alice);
  });

  describe("makeAddCopyToCollection", () => {
    const run = () =>
      makeAddCopyToCollection({
        collections,
        copies,
        events,
        clock: new FixedClock(NOW),
      });

    it("adds the owner's own copy and publishes CopyAddedToCollection", async () => {
      const copyId = await seedCopy(copies, alice, "copy-a");
      const result = await run()({
        actingMemberId: alice,
        collectionId,
        copyId,
      });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["CopyAddedToCollection"]);
    });

    it("rejects adding a copy owned by someone else (ownership enforcement)", async () => {
      const foreign = await seedCopy(copies, bob, "copy-b");
      const result = await run()({
        actingMemberId: alice,
        collectionId,
        copyId: foreign,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotCopyOwner");
    });

    it("rejects when the acting member does not own the collection", async () => {
      const copyId = await seedCopy(copies, bob, "copy-c");
      const result = await run()({ actingMemberId: bob, collectionId, copyId });
      expect(result.isErr).toBe(true);
      if (result.isErr) {
        expect(result.error.code).toBe("NotOwner");
        expect(result.error.message).toBe(
          "Acting member may not modify this collection",
        );
      }
    });

    it("rejects an unknown collection", async () => {
      const copyId = await seedCopy(copies, alice, "copy-c2");
      const result = await run()({
        actingMemberId: alice,
        collectionId: toCollectionId("ghost"),
        copyId,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CollectionNotFound");
    });

    it("rejects an unknown copy", async () => {
      const result = await run()({
        actingMemberId: alice,
        collectionId,
        copyId: toCopyId("ghost"),
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CopyNotFound");
    });

    it("surfaces the aggregate's WrongMemberType when adding a copy to a wishlist", async () => {
      const wishlistId = await seedCollection(alice, {
        id: toCollectionId("col-wish"),
        name: "Wishlist",
        isWishlist: true,
      });
      const copyId = await seedCopy(copies, alice, "copy-w");
      const result = await run()({
        actingMemberId: alice,
        collectionId: wishlistId,
        copyId,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("WrongMemberType");
    });
  });

  describe("makeRemoveCopyFromCollection", () => {
    const run = () =>
      makeRemoveCopyFromCollection({
        collections,
        events,
        clock: new FixedClock(NOW),
      });

    it("removes a member copy and publishes CopyRemovedFromCollection", async () => {
      const copyId = await seedCopy(copies, alice, "copy-d");
      await makeAddCopyToCollection({
        collections,
        copies,
        events: new RecordingEventPublisher(),
        clock: new FixedClock(NOW),
      })({ actingMemberId: alice, collectionId, copyId });

      const result = await run()({
        actingMemberId: alice,
        collectionId,
        copyId,
      });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["CopyRemovedFromCollection"]);
    });

    it("rejects an unknown collection", async () => {
      const result = await run()({
        actingMemberId: alice,
        collectionId: toCollectionId("ghost"),
        copyId: toCopyId("any"),
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CollectionNotFound");
    });

    it("rejects when the acting member does not own the collection", async () => {
      const copyId = await seedCopy(copies, alice, "copy-e");
      const result = await run()({ actingMemberId: bob, collectionId, copyId });
      expect(result.isErr).toBe(true);
      if (result.isErr) {
        expect(result.error.code).toBe("NotOwner");
        expect(result.error.message).toBe(
          "Acting member may not modify this collection",
        );
      }
    });

    it("surfaces the aggregate's CopyNotInCollection for a non-member copy", async () => {
      const copyId = await seedCopy(copies, alice, "copy-f");
      const result = await run()({
        actingMemberId: alice,
        collectionId,
        copyId,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CopyNotInCollection");
    });
  });

  describe("makeUpdateCollection", () => {
    const run = () =>
      makeUpdateCollection({ collections, events, clock: new FixedClock(NOW) });

    it("patches the owner's collection and publishes CollectionUpdated", async () => {
      const result = await run()({
        actingMemberId: alice,
        collectionId,
        name: "Renamed Shelf",
        description: "now with a description",
      });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["CollectionUpdated"]);
      const saved = await collections.findById(collectionId);
      expect(saved?.name).toBe("Renamed Shelf");
    });

    it("rejects when the acting member does not own the collection", async () => {
      const result = await run()({
        actingMemberId: bob,
        collectionId,
        name: "Hijacked",
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) {
        expect(result.error.code).toBe("NotOwner");
        expect(result.error.message).toBe(
          "Acting member may not update this collection",
        );
      }
    });

    // The uniqueness lookup runs ONLY when the name actually CHANGES, guarded by
    // `cmd.name !== undefined && cmd.name !== collection.name`. Spying on the repository call
    // pins both halves: it must be invoked on a real rename and skipped otherwise — directly
    // killing the `if (true)` and `&&`→`||` mutants regardless of the duplicate outcome.
    it("queries (owner, name) uniqueness when the name actually changes", async () => {
      const lookup = vi.spyOn(collections, "findByOwnerAndName");
      await run()({
        actingMemberId: alice,
        collectionId,
        name: "A Brand New Name",
      });
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(lookup).toHaveBeenCalledWith(alice, "A Brand New Name");
    });

    it("skips the uniqueness query on a no-op rename to the current name", async () => {
      const lookup = vi.spyOn(collections, "findByOwnerAndName");
      const result = await run()({
        actingMemberId: alice,
        collectionId,
        name: "My Shelf", // identical to the seeded name
      });
      expect(result.isOk).toBe(true);
      expect(lookup).not.toHaveBeenCalled();
    });

    it("skips the uniqueness query when the name is omitted entirely", async () => {
      const lookup = vi.spyOn(collections, "findByOwnerAndName");
      const result = await run()({
        actingMemberId: alice,
        collectionId,
        description: "no name supplied",
      });
      expect(result.isOk).toBe(true);
      expect(lookup).not.toHaveBeenCalled();
    });

    // `existing && existing.id !== collection.id`: a lookup that returns the collection ITSELF
    // (same id) must not be treated as a duplicate. Forcing the repo to echo back this very
    // collection kills the `if (true)` mutant on the inner guard.
    it("does not flag a duplicate when the only match is the collection itself", async () => {
      vi.spyOn(collections, "findByOwnerAndName").mockResolvedValue(
        await collections.findById(collectionId),
      );
      const result = await run()({
        actingMemberId: alice,
        collectionId,
        name: "Changed Name",
      });
      expect(result.isOk).toBe(true);
    });

    it("rejects an unknown collection", async () => {
      const result = await run()({
        actingMemberId: alice,
        collectionId: toCollectionId("ghost"),
        name: "Nope",
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CollectionNotFound");
    });

    it("rejects renaming to a name the owner already uses", async () => {
      await seedCollection(alice, {
        id: toCollectionId("col-other"),
        name: "Taken",
      });
      const result = await run()({
        actingMemberId: alice,
        collectionId,
        name: "Taken",
      });
      expect(result.isErr).toBe(true);
      if (result.isErr)
        expect(result.error.code).toBe("DuplicateCollectionName");
    });

    it("allows a no-op rename to the collection's current name", async () => {
      const result = await run()({
        actingMemberId: alice,
        collectionId,
        name: "My Shelf",
        color: "#abc",
      });
      expect(result.isOk).toBe(true);
      const saved = await collections.findById(collectionId);
      expect(saved?.toState().color).toBe("#abc");
    });
  });

  describe("makeDeleteCollection", () => {
    const run = () =>
      makeDeleteCollection({ collections, events, clock: new FixedClock(NOW) });

    it("deletes a non-default collection and publishes CollectionDeleted", async () => {
      const result = await run()({ actingMemberId: alice, collectionId });
      expect(result.isOk).toBe(true);
      expect(collections.size()).toBe(0);
      expect(events.names()).toEqual(["CollectionDeleted"]);
    });

    it("refuses to delete a default collection", async () => {
      const defaultId = await seedCollection(alice, {
        id: toCollectionId("col-default"),
        name: "All",
        isDefault: true,
      });
      const result = await run()({
        actingMemberId: alice,
        collectionId: defaultId,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr)
        expect(result.error.code).toBe("CannotDeleteDefaultCollection");
      expect(collections.size()).toBe(2);
    });

    it("rejects an unknown collection", async () => {
      const result = await run()({
        actingMemberId: alice,
        collectionId: toCollectionId("ghost"),
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CollectionNotFound");
      expect(collections.size()).toBe(1);
    });

    it("rejects when the acting member does not own the collection", async () => {
      const result = await run()({ actingMemberId: bob, collectionId });
      expect(result.isErr).toBe(true);
      if (result.isErr) {
        expect(result.error.code).toBe("NotOwner");
        expect(result.error.message).toBe(
          "Acting member may not delete this collection",
        );
      }
      expect(collections.size()).toBe(1);
    });
  });
});

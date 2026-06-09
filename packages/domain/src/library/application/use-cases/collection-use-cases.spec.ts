import { beforeEach, describe, expect, it } from "vitest";
import { toId } from "../../../shared-kernel";
import {
  CatalogSnapshot,
  Collection,
  CollectionId,
  Copy,
  CopyId,
  OwnerId,
  PuzzleDefinitionId,
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

const alice = toId<"OwnerId">("alice") as OwnerId;
const bob = toId<"OwnerId">("bob") as OwnerId;
const definitionId = toId<"PuzzleDefinitionId">("def1") as PuzzleDefinitionId;
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
    id: toId<"CopyId">(id) as CopyId,
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
      id: toId<"CollectionId">("col-seed") as CollectionId,
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
      if (result.isErr) expect(result.error.code).toBe("NotOwner");
    });

    it("rejects an unknown copy", async () => {
      const result = await run()({
        actingMemberId: alice,
        collectionId,
        copyId: toId<"CopyId">("ghost") as CopyId,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CopyNotFound");
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
        id: toId<"CollectionId">("col-default") as CollectionId,
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
  });
});

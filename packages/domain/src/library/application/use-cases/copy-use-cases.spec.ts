import { beforeEach, describe, expect, it } from "vitest";
import { toId } from "../../../shared-kernel";
import {
  CatalogSnapshot,
  Copy,
  CopyId,
  FileId,
  OwnerId,
  PuzzleDefinitionId,
} from "../../domain";
import {
  FakeCatalogSnapshotProvider,
  FakeCopyReservationPort,
  FixedClock,
  InMemoryCopyRepository,
  RecordingEventPublisher,
  SequentialCopyIdGenerator,
} from "../testing";
import { makeAcquireCopy } from "./acquire-copy";
import { makeAddCopyImage } from "./add-copy-image";
import { makeChangeCopyCondition } from "./change-copy-condition";
import { makeUpdateCopySharing } from "./update-copy-sharing";

const alice = toId<"OwnerId">("alice") as OwnerId;
const bob = toId<"OwnerId">("bob") as OwnerId;
const definitionId = toId<"PuzzleDefinitionId">("def1") as PuzzleDefinitionId;
const NOW = new Date("2026-06-08T10:00:00Z");

const snapshot = (): CatalogSnapshot =>
  CatalogSnapshot.create({
    puzzleDefinitionId: definitionId,
    title: "Owl",
    pieceCount: 500,
  });

describe("makeAcquireCopy", () => {
  let copies: InMemoryCopyRepository;
  let snapshots: FakeCatalogSnapshotProvider;
  let events: RecordingEventPublisher;

  const acquire = () =>
    makeAcquireCopy({
      copies,
      snapshots,
      ids: new SequentialCopyIdGenerator(),
      events,
      clock: new FixedClock(NOW),
    });

  beforeEach(() => {
    copies = new InMemoryCopyRepository();
    snapshots = new FakeCatalogSnapshotProvider();
    events = new RecordingEventPublisher();
  });

  it("fetches the snapshot, saves the copy, and publishes CopyAcquired", async () => {
    snapshots.seed(snapshot());
    const result = await acquire()({
      ownerId: alice,
      puzzleDefinitionId: definitionId,
      condition: "good",
    });
    expect(result.isOk).toBe(true);
    expect(copies.size()).toBe(1);
    expect(events.names()).toEqual(["CopyAcquired"]);
  });

  it("holds the fetched snapshot on the saved copy", async () => {
    snapshots.seed(snapshot());
    const result = await acquire()({
      ownerId: alice,
      puzzleDefinitionId: definitionId,
      condition: "good",
    });
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      const saved = await copies.findById(result.value);
      expect(saved?.toState().snapshot.title).toBe("Owl");
    }
  });

  it("rejects when the Catalog has no snapshot for the definition", async () => {
    const result = await acquire()({
      ownerId: alice,
      puzzleDefinitionId: definitionId,
      condition: "good",
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("SnapshotUnavailable");
    expect(events.published).toHaveLength(0);
  });
});

describe("copy mutation use cases", () => {
  let copies: InMemoryCopyRepository;
  let reservations: FakeCopyReservationPort;
  let events: RecordingEventPublisher;
  let copyId: CopyId;

  beforeEach(async () => {
    copies = new InMemoryCopyRepository();
    reservations = new FakeCopyReservationPort();
    events = new RecordingEventPublisher();
    const acquired = Copy.acquire({
      id: toId<"CopyId">("copy-seed") as CopyId,
      ownerId: alice,
      snapshot: snapshot(),
      condition: "good",
      now: NOW,
    });
    if (!acquired.isOk) throw new Error("setup");
    copyId = acquired.value.id;
    await copies.save(acquired.value);
  });

  describe("makeChangeCopyCondition", () => {
    const run = () =>
      makeChangeCopyCondition({ copies, events, clock: new FixedClock(NOW) });

    it("re-grades the owner's copy and publishes CopyConditionChanged", async () => {
      const result = await run()({
        actingMemberId: alice,
        copyId,
        condition: "fair",
      });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["CopyConditionChanged"]);
    });

    it("rejects a non-owner", async () => {
      const result = await run()({
        actingMemberId: bob,
        copyId,
        condition: "fair",
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotOwner");
    });

    it("rejects an unknown copy", async () => {
      const result = await run()({
        actingMemberId: alice,
        copyId: toId<"CopyId">("ghost") as CopyId,
        condition: "fair",
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CopyNotFound");
    });
  });

  describe("makeUpdateCopySharing", () => {
    const run = () =>
      makeUpdateCopySharing({
        copies,
        reservations,
        events,
        clock: new FixedClock(NOW),
      });

    it("updates sharing and publishes CopyMadeAvailable", async () => {
      const result = await run()({
        actingMemberId: alice,
        copyId,
        visibility: "visible",
        forTrade: true,
      });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["CopyMadeAvailable"]);
    });

    it("refuses to make a reserved copy available (Exchange seam)", async () => {
      reservations.reserve(copyId);
      const result = await run()({
        actingMemberId: alice,
        copyId,
        visibility: "visible",
        forTrade: true,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CopyReserved");
      expect(events.published).toHaveLength(0);
    });

    it("allows withdrawing availability even when reserved (not making available)", async () => {
      reservations.reserve(copyId);
      const result = await run()({
        actingMemberId: alice,
        copyId,
        visibility: "private",
      });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["CopyMadeUnavailable"]);
    });
  });

  describe("makeAddCopyImage", () => {
    const run = () =>
      makeAddCopyImage({ copies, events, clock: new FixedClock(NOW) });

    it("adds an image to the owner's copy and publishes CopyImageAdded", async () => {
      const result = await run()({
        actingMemberId: alice,
        copyId,
        fileId: toId<"FileId">("file1") as FileId,
        tag: "box_front",
      });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["CopyImageAdded"]);
    });

    it("rejects a non-owner", async () => {
      const result = await run()({
        actingMemberId: bob,
        copyId,
        fileId: toId<"FileId">("file1") as FileId,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotOwner");
    });
  });
});

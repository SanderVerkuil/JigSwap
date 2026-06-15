import { beforeEach, describe, expect, it } from "vitest";
import {
  toCopyId,
  toFileId,
  toOwnerId,
  toPuzzleDefinitionId,
} from "../../../shared-kernel";
import { CatalogSnapshot, Copy, CopyId } from "../../domain";
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
import { makeDeleteCopy } from "./delete-copy";
import { makeSetCopyCover } from "./set-copy-cover";
import { makeTransferCopyOwnership } from "./transfer-copy-ownership";
import { makeUpdateCopyDetails } from "./update-copy-details";
import { makeUpdateCopySharing } from "./update-copy-sharing";

const alice = toOwnerId("alice");
const bob = toOwnerId("bob");
const definitionId = toPuzzleDefinitionId("def1");
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
    snapshots.seed(snapshot(), { status: "approved", submitterId: bob });
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
    snapshots.seed(snapshot(), { status: "approved", submitterId: bob });
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

  it("rejects when the Catalog has no definition for the id (PuzzleNotFound)", async () => {
    const result = await acquire()({
      ownerId: alice,
      puzzleDefinitionId: definitionId,
      condition: "good",
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("PuzzleNotFound");
    expect(events.published).toHaveLength(0);
  });

  it("lets a member acquire their OWN pending submission", async () => {
    snapshots.seed(snapshot(), { status: "pending", submitterId: alice });
    const result = await acquire()({
      ownerId: alice,
      puzzleDefinitionId: definitionId,
      condition: "good",
    });
    expect(result.isOk).toBe(true);
    expect(events.names()).toEqual(["CopyAcquired"]);
  });

  it("lets a member acquire their OWN rejected submission", async () => {
    snapshots.seed(snapshot(), { status: "rejected", submitterId: alice });
    const result = await acquire()({
      ownerId: alice,
      puzzleDefinitionId: definitionId,
      condition: "good",
    });
    expect(result.isOk).toBe(true);
    expect(events.names()).toEqual(["CopyAcquired"]);
  });

  it("refuses to acquire someone else's pending submission (PuzzleNotAcquirable)", async () => {
    snapshots.seed(snapshot(), { status: "pending", submitterId: bob });
    const result = await acquire()({
      ownerId: alice,
      puzzleDefinitionId: definitionId,
      condition: "good",
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("PuzzleNotAcquirable");
    expect(events.published).toHaveLength(0);
    expect(copies.size()).toBe(0);
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
      id: toCopyId("copy-seed"),
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
      if (result.isErr) {
        expect(result.error.code).toBe("NotOwner");
        expect(result.error.message).toBe(
          "Acting member may not change this copy's condition",
        );
      }
    });

    it("rejects an unknown copy", async () => {
      const result = await run()({
        actingMemberId: alice,
        copyId: toCopyId("ghost"),
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

    it("rejects a non-owner", async () => {
      const result = await run()({
        actingMemberId: bob,
        copyId,
        visibility: "visible",
        forTrade: true,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) {
        expect(result.error.code).toBe("NotOwner");
        expect(result.error.message).toBe(
          "Acting member may not update this copy's sharing",
        );
      }
    });

    it("rejects an unknown copy", async () => {
      const result = await run()({
        actingMemberId: alice,
        copyId: toCopyId("ghost"),
        visibility: "visible",
        forTrade: true,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CopyNotFound");
    });

    it("does not consult the reservation seam when withdrawing availability", async () => {
      // A private (not-for-exchange) setting must short-circuit before isReserved(), so the
      // `&&` guard's first operand genuinely gates the reservation lookup.
      reservations.reserve(copyId);
      const result = await run()({
        actingMemberId: alice,
        copyId,
        visibility: "private",
      });
      expect(result.isOk).toBe(true);
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
        fileId: toFileId("file1"),
        tag: "box_front",
      });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["CopyImageAdded"]);
    });

    it("rejects a non-owner", async () => {
      const result = await run()({
        actingMemberId: bob,
        copyId,
        fileId: toFileId("file1"),
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) {
        expect(result.error.code).toBe("NotOwner");
        expect(result.error.message).toBe(
          "Acting member may not add an image to this copy",
        );
      }
    });

    it("rejects an unknown copy", async () => {
      const result = await run()({
        actingMemberId: alice,
        copyId: toCopyId("ghost"),
        fileId: toFileId("file1"),
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CopyNotFound");
      expect(events.published).toHaveLength(0);
    });

    it("forwards the image metadata fields onto the copy", async () => {
      const takenAt = new Date("2026-01-01T00:00:00Z");
      const result = await run()({
        actingMemberId: alice,
        copyId,
        fileId: toFileId("file2"),
        title: "Front of box",
        description: "Pristine",
        tag: "box_front",
        takenAt,
      });
      expect(result.isOk).toBe(true);
      const saved = await copies.findById(copyId);
      const images = saved?.toState().images ?? [];
      expect(images).toHaveLength(1);
      expect(images[0]).toMatchObject({
        title: "Front of box",
        description: "Pristine",
        tag: "box_front",
        takenAt,
      });
    });
  });

  describe("makeSetCopyCover", () => {
    const run = () =>
      makeSetCopyCover({ copies, events, clock: new FixedClock(NOW) });

    it("sets the owner's copy cover and publishes CopyCoverChanged", async () => {
      const result = await run()({
        actingMemberId: alice,
        copyId,
        coverImageId: "img-1",
      });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["CopyCoverChanged"]);
      const saved = await copies.findById(copyId);
      expect(saved?.toState().coverImageId).toBe("img-1");
    });

    it("clears the cover (null) and publishes CopyCoverChanged", async () => {
      await run()({ actingMemberId: alice, copyId, coverImageId: "img-1" });
      const result = await run()({
        actingMemberId: alice,
        copyId,
        coverImageId: null,
      });
      expect(result.isOk).toBe(true);
      // Two cover changes published; the second carries the cleared (null) selection.
      expect(events.names()).toEqual(["CopyCoverChanged", "CopyCoverChanged"]);
      const saved = await copies.findById(copyId);
      expect(saved?.toState().coverImageId).toBeUndefined();
    });

    it("rejects a non-owner", async () => {
      const result = await run()({
        actingMemberId: bob,
        copyId,
        coverImageId: "img-1",
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) {
        expect(result.error.code).toBe("NotOwner");
        expect(result.error.message).toBe(
          "Acting member may not change this copy's cover",
        );
      }
      expect(events.published).toHaveLength(0);
    });

    it("rejects an unknown copy", async () => {
      const result = await run()({
        actingMemberId: alice,
        copyId: toCopyId("ghost"),
        coverImageId: "img-1",
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CopyNotFound");
      expect(events.published).toHaveLength(0);
    });
  });

  describe("makeUpdateCopyDetails", () => {
    const run = () =>
      makeUpdateCopyDetails({ copies, events, clock: new FixedClock(NOW) });

    it("applies the fields to the owner's copy and publishes CopyDetailsUpdated", async () => {
      const result = await run()({
        actingMemberId: alice,
        copyId,
        missingPiecesCount: 3,
        notes: "corner piece missing",
      });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["CopyDetailsUpdated"]);
      const saved = await copies.findById(copyId);
      expect(saved?.toState().missingPiecesCount).toBe(3);
      expect(saved?.toState().notes).toBe("corner piece missing");
    });

    it("rejects a non-owner", async () => {
      const result = await run()({
        actingMemberId: bob,
        copyId,
        notes: "hi",
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) {
        expect(result.error.code).toBe("NotOwner");
        expect(result.error.message).toBe(
          "Acting member may not update this copy's details",
        );
      }
    });

    it("rejects an unknown copy", async () => {
      const result = await run()({
        actingMemberId: alice,
        copyId: toCopyId("ghost"),
        notes: "hi",
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CopyNotFound");
    });
  });

  describe("makeDeleteCopy", () => {
    const run = () =>
      makeDeleteCopy({
        copies,
        reservations,
        events,
        clock: new FixedClock(NOW),
      });

    it("removes the owner's copy and publishes CopyDeleted", async () => {
      const result = await run()({ actingMemberId: alice, copyId });
      expect(result.isOk).toBe(true);
      expect(copies.size()).toBe(0);
      expect(events.names()).toEqual(["CopyDeleted"]);
    });

    it("rejects a non-owner", async () => {
      const result = await run()({ actingMemberId: bob, copyId });
      expect(result.isErr).toBe(true);
      if (result.isErr) {
        expect(result.error.code).toBe("NotOwner");
        expect(result.error.message).toBe(
          "Acting member may not delete this copy",
        );
      }
      expect(copies.size()).toBe(1);
    });

    it("rejects an unknown copy", async () => {
      const result = await run()({
        actingMemberId: alice,
        copyId: toCopyId("ghost"),
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CopyNotFound");
    });

    it("refuses to delete a copy reserved by an active exchange (Exchange seam)", async () => {
      reservations.reserve(copyId);
      const result = await run()({ actingMemberId: alice, copyId });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CopyReserved");
      expect(copies.size()).toBe(1);
      expect(events.published).toHaveLength(0);
    });
  });

  describe("makeTransferCopyOwnership", () => {
    const run = () =>
      makeTransferCopyOwnership({ copies, events, clock: new FixedClock(NOW) });

    it("reassigns the copy to the new owner and publishes CopyOwnershipTransferred", async () => {
      const result = await run()({ copyId, newOwner: bob });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["CopyOwnershipTransferred"]);
      const saved = await copies.findById(copyId);
      expect(saved?.ownerId).toBe(bob);
    });

    it("rejects an unknown copy", async () => {
      const result = await run()({
        copyId: toCopyId("ghost"),
        newOwner: bob,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CopyNotFound");
      expect(events.published).toHaveLength(0);
    });
  });
});

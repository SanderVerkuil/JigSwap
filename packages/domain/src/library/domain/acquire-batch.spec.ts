import { describe, expect, it } from "vitest";
import { toPuzzleDefinitionId } from "../../shared-kernel";
import { MAX_ACQUIRE_BATCH, planAcquireBatch } from "./acquire-batch";
import { LibraryError } from "./errors";

const id = (n: number) => toPuzzleDefinitionId(`def-${n}`);
const items = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ puzzleDefinitionId: id(i) }));

describe("planAcquireBatch", () => {
  it("caps a batch at 25 definitions", () => {
    expect(MAX_ACQUIRE_BATCH).toBe(25);
  });

  it("keeps a full batch of distinct definitions in order", () => {
    const result = planAcquireBatch(items(MAX_ACQUIRE_BATCH));
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.map((i) => i.puzzleDefinitionId)).toEqual(
      items(MAX_ACQUIRE_BATCH).map((i) => i.puzzleDefinitionId),
    );
  });

  it("rejects one definition over the cap", () => {
    const result = planAcquireBatch(items(MAX_ACQUIRE_BATCH + 1));
    expect(result.isErr).toBe(true);
    if (!result.isErr) return;
    expect(result.error.code).toBe("AcquireBatchTooLarge");
    expect(result.error.message).toBe(
      "At most 25 puzzles can be added at once",
    );
  });

  it("rejects an empty batch", () => {
    const result = planAcquireBatch([]);
    expect(result.isErr).toBe(true);
    if (!result.isErr) return;
    expect(result.error.code).toBe("EmptyAcquireBatch");
    expect(result.error.message).toBe("Pick at least one puzzle to add");
  });

  it("collapses duplicates to the first occurrence, and counts the cap after that", () => {
    const duplicated = [
      ...items(MAX_ACQUIRE_BATCH),
      { puzzleDefinitionId: id(0), forTrade: true },
    ];
    const result = planAcquireBatch(duplicated);
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value).toHaveLength(MAX_ACQUIRE_BATCH);
    // The first occurrence wins, so the later forTrade: true is dropped with its duplicate.
    expect(result.value[0]).toEqual({
      puzzleDefinitionId: id(0),
      forTrade: false,
    });
  });

  it("defaults forTrade to false and keeps a per-item override", () => {
    const result = planAcquireBatch([
      { puzzleDefinitionId: id(1) },
      { puzzleDefinitionId: id(2), forTrade: true },
      { puzzleDefinitionId: id(3), forTrade: false },
    ]);
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value).toEqual([
      { puzzleDefinitionId: id(1), forTrade: false },
      { puzzleDefinitionId: id(2), forTrade: true },
      { puzzleDefinitionId: id(3), forTrade: false },
    ]);
  });
});

describe("LibraryError batch factories", () => {
  it("acquireBatchTooLarge interpolates the cap", () => {
    const e = LibraryError.acquireBatchTooLarge(7);
    expect(e.code).toBe("AcquireBatchTooLarge");
    expect(e.name).toBe("LibraryError");
    expect(e.message).toBe("At most 7 puzzles can be added at once");
  });

  it("emptyAcquireBatch", () => {
    const e = LibraryError.emptyAcquireBatch();
    expect(e.code).toBe("EmptyAcquireBatch");
    expect(e.message).toBe("Pick at least one puzzle to add");
  });
});

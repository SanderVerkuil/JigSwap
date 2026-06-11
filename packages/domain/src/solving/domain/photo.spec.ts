import { describe, expect, it } from "vitest";
import { toFileId } from "../../shared-kernel";
import { Photo } from "./photo";

describe("Photo", () => {
  it("carries its file id", () => {
    const fileId = toFileId("file-1");
    expect(Photo.of(fileId).fileId).toBe(fileId);
  });

  it("compares by file id", () => {
    const a = Photo.of(toFileId("file-1"));
    expect(a.equals(Photo.of(toFileId("file-1")))).toBe(true);
    expect(a.equals(Photo.of(toFileId("file-2")))).toBe(false);
  });
});

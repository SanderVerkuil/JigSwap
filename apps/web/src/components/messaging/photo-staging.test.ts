import { describe, expect, it } from "vitest";
import { segmentMessages } from "./format";
import {
  MAX_STAGED_PHOTOS,
  photoAspect,
  refusalOf,
  remainingSlots,
  sendState,
  stagingReducer,
  type StagedPhoto,
} from "./photo-staging";

const ready = (key: string, attachmentId = `att-${key}`): StagedPhoto => ({
  key,
  status: "ready",
  attachmentId,
});

describe("stagingReducer", () => {
  it("walks a chip from preparing through upload progress to ready", () => {
    let photos = stagingReducer([], { type: "add", keys: ["a"] });
    expect(photos).toEqual([{ key: "a", status: "preparing" }]);
    photos = stagingReducer(photos, {
      type: "prepared",
      key: "a",
      previewUrl: "blob:a",
    });
    expect(photos[0]).toMatchObject({ status: "uploading", progress: 0 });
    photos = stagingReducer(photos, {
      type: "progress",
      key: "a",
      progress: 0.4,
    });
    expect(photos[0]).toMatchObject({ status: "uploading", progress: 0.4 });
    photos = stagingReducer(photos, { type: "staging", key: "a" });
    photos = stagingReducer(photos, {
      type: "ready",
      key: "a",
      attachmentId: "att1",
    });
    expect(photos[0]).toEqual({
      key: "a",
      previewUrl: "blob:a",
      status: "ready",
      attachmentId: "att1",
    });
  });

  it("records a refusal with its reason and keeps the preview", () => {
    let photos = stagingReducer([], { type: "add", keys: ["a"] });
    photos = stagingReducer(photos, {
      type: "prepared",
      key: "a",
      previewUrl: "blob:a",
    });
    photos = stagingReducer(photos, {
      type: "refused",
      key: "a",
      reason: "tooLarge",
    });
    expect(photos[0]).toEqual({
      key: "a",
      previewUrl: "blob:a",
      status: "refused",
      reason: "tooLarge",
    });
  });

  it("ignores updates for a chip that was removed meanwhile", () => {
    let photos = stagingReducer([], { type: "add", keys: ["a", "b"] });
    photos = stagingReducer(photos, { type: "remove", key: "a" });
    photos = stagingReducer(photos, {
      type: "ready",
      key: "a",
      attachmentId: "att",
    });
    expect(photos.map((photo) => photo.key)).toEqual(["b"]);
  });

  it("clamps progress and only applies it while uploading", () => {
    let photos = stagingReducer([], { type: "add", keys: ["a"] });
    photos = stagingReducer(photos, {
      type: "progress",
      key: "a",
      progress: 0.5,
    });
    expect(photos[0].status).toBe("preparing");
    photos = stagingReducer(photos, {
      type: "prepared",
      key: "a",
      previewUrl: "blob:a",
    });
    photos = stagingReducer(photos, {
      type: "progress",
      key: "a",
      progress: 3,
    });
    expect(photos[0]).toMatchObject({ progress: 1 });
  });

  it("allows at most four photos", () => {
    expect(MAX_STAGED_PHOTOS).toBe(4);
    expect(remainingSlots([])).toBe(4);
    expect(remainingSlots([ready("a"), ready("b"), ready("c")])).toBe(1);
    expect(
      remainingSlots([ready("a"), ready("b"), ready("c"), ready("d")]),
    ).toBe(0);
  });
});

describe("sendState", () => {
  it("needs text when nothing is staged", () => {
    expect(sendState({ body: "  ", photos: [], hasCopy: false })).toEqual({
      kind: "disabled",
    });
    expect(sendState({ body: "hi", photos: [], hasCopy: false })).toEqual({
      kind: "text",
    });
    expect(sendState({ body: "hi", photos: [], hasCopy: true })).toEqual({
      kind: "text",
    });
  });

  it("waits until every upload has finished", () => {
    const uploading: StagedPhoto = {
      key: "b",
      status: "uploading",
      progress: 0.5,
    };
    expect(
      sendState({
        body: "hi",
        photos: [ready("a"), uploading],
        hasCopy: false,
      }),
    ).toEqual({ kind: "disabled" });
  });

  it("sends the ready photos without text, skipping refused ones", () => {
    const refused: StagedPhoto = {
      key: "b",
      status: "refused",
      reason: "failed",
    };
    expect(
      sendState({ body: "", photos: [ready("a"), refused], hasCopy: false }),
    ).toEqual({ kind: "photos", attachmentIds: ["att-a"] });
  });

  it("sends text alone when every photo was refused", () => {
    const refused: StagedPhoto = {
      key: "b",
      status: "refused",
      reason: "failed",
    };
    expect(sendState({ body: "", photos: [refused], hasCopy: false })).toEqual({
      kind: "disabled",
    });
    expect(
      sendState({ body: "hi", photos: [refused], hasCopy: false }),
    ).toEqual({ kind: "text" });
  });

  it("blocks a puzzle together with photos", () => {
    expect(
      sendState({ body: "hi", photos: [ready("a")], hasCopy: true }),
    ).toEqual({ kind: "blocked" });
  });
});

describe("refusalOf", () => {
  it("maps backend codes to chip reasons", () => {
    expect(refusalOf("ImageTooLarge")).toBe("tooLarge");
    expect(refusalOf("UnsupportedImageType")).toBe("unsupported");
    expect(refusalOf("UploadExpired")).toBe("expired");
    expect(refusalOf("RateLimited")).toBe("rateLimited");
    expect(refusalOf(undefined)).toBe("failed");
    expect(refusalOf("InvalidUpload")).toBe("failed");
  });
});

describe("photoAspect", () => {
  it("clamps between 3:4 and 16:9 and defaults to 4:3", () => {
    expect(photoAspect(1600, 1200)).toBeCloseTo(4 / 3);
    expect(photoAspect(1000, 4000)).toBeCloseTo(3 / 4);
    expect(photoAspect(4000, 1000)).toBeCloseTo(16 / 9);
    expect(photoAspect()).toBeCloseTo(4 / 3);
  });
});

describe("segmentMessages", () => {
  const msg = (id: string, kind: string, sentAt: number, isMine = false) => ({
    id,
    kind,
    sentAt,
    isMine,
  });

  it("groups photos sent within a minute into one gallery", () => {
    const segments = segmentMessages([
      msg("t1", "text", 0),
      msg("p1", "image", 1_000),
      msg("p2", "image", 30_000),
      msg("p3", "image", 90_000),
      msg("p4", "image", 200_000),
      msg("t2", "text", 201_000),
    ]);
    expect(
      segments.map((segment) =>
        segment.type === "message"
          ? segment.message.id
          : segment.messages.map((message) => message.id),
      ),
    ).toEqual(["t1", ["p1", "p2", "p3"], ["p4"], "t2"]);
  });

  it("caps a gallery at four photos and breaks it at a text message", () => {
    const segments = segmentMessages([
      msg("p1", "image", 0),
      msg("p2", "image", 1),
      msg("p3", "image", 2),
      msg("p4", "image", 3),
      msg("p5", "image", 4),
      msg("t", "text", 5),
      msg("p6", "image", 6),
    ]);
    expect(
      segments.map((segment) =>
        segment.type === "message"
          ? segment.message.id
          : segment.messages.length,
      ),
    ).toEqual([4, 1, "t", 1]);
  });

  it("never groups my photo with the other participant's", () => {
    const segments = segmentMessages([
      msg("p1", "image", 0, true),
      msg("p2", "image", 1, false),
    ]);
    expect(segments.map((segment) => segment.type)).toEqual([
      "photos",
      "photos",
    ]);
  });
});

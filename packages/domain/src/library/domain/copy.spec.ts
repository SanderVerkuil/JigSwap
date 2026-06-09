import { describe, expect, it } from "vitest";
import { DomainEvent, toId } from "../../shared-kernel";
import { Acquisition } from "./acquisition";
import { CatalogSnapshot } from "./catalog-snapshot";
import { Copy } from "./copy";
import { CopyImage, FileId } from "./copy-image";
import {
  CopyAcquired,
  CopyConditionChanged,
  CopyMadeAvailable,
  CopyMadeUnavailable,
} from "./events";
import { CopyId, OwnerId, PuzzleDefinitionId } from "./ids";
import { Price } from "./price";
import { SharingSetting } from "./sharing-setting";

const copyId = toId<"CopyId">("copy1") as CopyId;
const owner = toId<"OwnerId">("alice") as OwnerId;
const definitionId = toId<"PuzzleDefinitionId">("def1") as PuzzleDefinitionId;
const NOW = new Date("2026-06-08T10:00:00Z");
const LATER = new Date("2026-06-09T10:00:00Z");

const snapshot = (): CatalogSnapshot =>
  CatalogSnapshot.create({
    puzzleDefinitionId: definitionId,
    title: "Starry Night",
    pieceCount: 1000,
    brand: "Ravensburger",
  });

const acquire = (): Copy => {
  const result = Copy.acquire({
    id: copyId,
    ownerId: owner,
    snapshot: snapshot(),
    condition: "good",
    now: NOW,
  });
  if (!result.isOk) throw new Error("setup failed");
  return result.value;
};

const names = (events: readonly DomainEvent[]): string[] =>
  events.map((e) => e.name);

describe("Copy.acquire", () => {
  it("holds the catalog snapshot and references the definition id", () => {
    const copy = acquire();
    const state = copy.toState();
    expect(state.puzzleDefinitionId).toBe(definitionId);
    expect(state.snapshot.title).toBe("Starry Night");
    expect(state.snapshot.pieceCount).toBe(1000);
  });

  it("exposes id, ownerId and condition through its getters", () => {
    const copy = acquire();
    expect(copy.id).toBe(copyId);
    expect(copy.ownerId).toBe(owner);
    expect(copy.condition).toBe("good");
  });

  it("defaults to an empty (unknown) acquisition when none is supplied", () => {
    const copy = acquire();
    const acquisition = copy.toState().acquisition;
    expect(acquisition.date).toBeUndefined();
    expect(acquisition.source).toBeUndefined();
    expect(acquisition.price).toBeUndefined();
  });

  it("defaults to a private sharing setting (not available for any exchange)", () => {
    const copy = acquire();
    expect(copy.sharing.visibility).toBe("private");
    expect(copy.sharing.isAvailableForAnyExchange()).toBe(false);
  });

  it("records CopyAcquired carrying owner, definition, and condition", () => {
    const copy = acquire();
    const events = copy.pullEvents();
    expect(names(events)).toEqual(["CopyAcquired"]);
    const acquired = events[0] as CopyAcquired;
    expect(acquired.ownerId).toBe(owner);
    expect(acquired.puzzleDefinitionId).toBe(definitionId);
    expect(acquired.condition).toBe("good");
    expect(acquired.occurredAt).toBe(NOW);
  });

  it("captures an optional acquisition with price", () => {
    const price = Price.create(1500, "EUR");
    if (!price.isOk) throw new Error("setup");
    const result = Copy.acquire({
      id: copyId,
      ownerId: owner,
      snapshot: snapshot(),
      condition: "like_new",
      acquisition: Acquisition.create({ source: "gift", price: price.value }),
      now: NOW,
    });
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.toState().acquisition.source).toBe("gift");
      expect(result.value.toState().acquisition.price?.amountCents).toBe(1500);
    }
  });
});

describe("changeCondition", () => {
  it("re-grades and records a from/to CopyConditionChanged", () => {
    const copy = acquire();
    copy.pullEvents();
    const r = copy.changeCondition("fair", LATER);
    expect(r.isOk).toBe(true);
    expect(copy.condition).toBe("fair");
    const events = copy.pullEvents();
    expect(names(events)).toEqual(["CopyConditionChanged"]);
    const changed = events[0] as CopyConditionChanged;
    expect(changed.from).toBe("good");
    expect(changed.to).toBe("fair");
  });

  it("is a no-op (no event) when the grade is unchanged", () => {
    const copy = acquire();
    copy.pullEvents();
    const r = copy.changeCondition("good", LATER);
    expect(r.isOk).toBe(true);
    expect(copy.pullEvents()).toHaveLength(0);
  });
});

describe("updateSharing", () => {
  it("emits CopyMadeAvailable when offered for an exchange kind", () => {
    const copy = acquire();
    copy.pullEvents();
    const setting = SharingSetting.create({
      visibility: "visible",
      forTrade: true,
    });
    copy.updateSharing(setting, LATER);
    const events = copy.pullEvents();
    expect(names(events)).toEqual(["CopyMadeAvailable"]);
    const made = events[0] as CopyMadeAvailable;
    expect(made.forTrade).toBe(true);
    expect(copy.sharing.isAvailableFor("trade")).toBe(true);
  });

  it("emits CopyMadeUnavailable when no exchange kind is offered", () => {
    const copy = acquire();
    copy.updateSharing(
      SharingSetting.create({ visibility: "visible", forTrade: true }),
      NOW,
    );
    copy.pullEvents();
    copy.updateSharing(SharingSetting.create({ visibility: "visible" }), LATER);
    const events = copy.pullEvents();
    expect(names(events)).toEqual(["CopyMadeUnavailable"]);
    expect(events[0]).toBeInstanceOf(CopyMadeUnavailable);
  });
});

describe("addImage", () => {
  it("attaches an image and records CopyImageAdded with the tag", () => {
    const copy = acquire();
    copy.pullEvents();
    const image = CopyImage.create({
      fileId: toId<"FileId">("file1") as FileId,
      tag: "box_front",
    });
    copy.addImage(image, LATER);
    expect(copy.toState().images).toHaveLength(1);
    const events = copy.pullEvents();
    expect(names(events)).toEqual(["CopyImageAdded"]);
  });
});

describe("rehydrate / toState round-trip", () => {
  it("rehydrates without re-recording events", () => {
    const original = acquire();
    const state = original.toState();
    const restored = Copy.rehydrate(state);
    expect(restored.pullEvents()).toHaveLength(0);
    expect(restored.toState()).toEqual(state);
  });
});

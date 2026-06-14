import { describe, expect, it } from "vitest";
import {
  DomainEvent,
  toCopyId,
  toFileId,
  toOwnerId,
  toPuzzleDefinitionId,
} from "../../shared-kernel";
import { Acquisition } from "./acquisition";
import { CatalogSnapshot } from "./catalog-snapshot";
import { Copy } from "./copy";
import { CopyImage } from "./copy-image";
import {
  CopyAcquired,
  CopyConditionChanged,
  CopyCoverChanged,
  CopyMadeAvailable,
  CopyMadeUnavailable,
} from "./events";

import { Price } from "./price";
import { SharingSetting } from "./sharing-setting";

const copyId = toCopyId("copy1");
const owner = toOwnerId("alice");
const definitionId = toPuzzleDefinitionId("def1");
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
      fileId: toFileId("file1"),
      tag: "box_front",
    });
    copy.addImage(image, LATER);
    expect(copy.toState().images).toHaveLength(1);
    const events = copy.pullEvents();
    expect(names(events)).toEqual(["CopyImageAdded"]);
  });
});

describe("changeCover", () => {
  it("sets the cover to one of the copy's photos and records CopyCoverChanged", () => {
    const copy = acquire();
    copy.pullEvents();
    const r = copy.changeCover("img-1", LATER);
    expect(r.isOk).toBe(true);
    expect(copy.toState().coverImageId).toBe("img-1");
    expect(copy.toState().updatedAt).toBe(LATER);
    const events = copy.pullEvents();
    expect(names(events)).toEqual(["CopyCoverChanged"]);
    const changed = events[0] as CopyCoverChanged;
    expect(changed.coverImageId).toBe("img-1");
    expect(changed.occurredAt).toBe(LATER);
  });

  it("clears the cover (null) back to the global image and records the change", () => {
    const copy = acquire();
    copy.changeCover("img-1", NOW);
    copy.pullEvents();
    const r = copy.changeCover(null, LATER);
    expect(r.isOk).toBe(true);
    expect(copy.toState().coverImageId).toBeUndefined();
    const events = copy.pullEvents();
    expect(names(events)).toEqual(["CopyCoverChanged"]);
    const changed = events[0] as CopyCoverChanged;
    expect(changed.coverImageId).toBeNull();
  });
});

describe("Copy.transferTo", () => {
  const newOwner = toOwnerId("bob");

  // A copy carrying owner-specific state, so the transfer's resets are observable.
  const owned = (): Copy => {
    const copy = acquire();
    copy.updateSharing(
      SharingSetting.create({ forTrade: true, visibility: "visible" }),
      NOW,
    );
    copy.updateDetails({ missingPiecesCount: 2, notes: "corner bent" }, NOW);
    copy.pullEvents();
    return copy;
  };

  it("reassigns ownership and records CopyOwnershipTransferred with both owners", () => {
    const copy = owned();
    const result = copy.transferTo(newOwner, LATER);
    expect(result.isOk).toBe(true);
    expect(copy.ownerId).toBe(newOwner);
    const events = copy.pullEvents();
    expect(names(events)).toEqual(["CopyOwnershipTransferred"]);
    expect(events[0]).toMatchObject({
      copyId,
      previousOwner: owner,
      newOwner,
      occurredAt: LATER,
    });
  });

  it("resets owner-specific fields: sharing private, acquisition trade, notes cleared", () => {
    const copy = owned();
    copy.transferTo(newOwner, LATER);
    const state = copy.toState();
    expect(state.sharing.isAvailableForAnyExchange()).toBe(false);
    expect(state.acquisition.source).toBe("trade");
    expect(state.acquisition.date).toBe(LATER);
    expect(state.notes).toBeUndefined();
    expect(state.updatedAt).toBe(LATER);
  });

  it("keeps the physical facts: condition, snapshot, missing pieces", () => {
    const copy = owned();
    copy.transferTo(newOwner, LATER);
    const state = copy.toState();
    expect(state.condition).toBe("good");
    expect(state.snapshot.title).toBe("Starry Night");
    expect(state.missingPiecesCount).toBe(2);
  });
});

describe("Copy possession (lend / return)", () => {
  const borrower = toOwnerId("bob");

  it("a freshly acquired copy is held by its owner", () => {
    expect(acquire().toState().heldBy).toBe(owner);
  });

  it("lendOut hands possession to the borrower and takes it off the market", () => {
    const copy = acquire();
    copy.updateSharing(
      SharingSetting.create({ forTrade: true, visibility: "visible" }),
      NOW,
    );
    copy.pullEvents();
    const result = copy.lendOut(borrower, LATER);
    expect(result.isOk).toBe(true);
    const state = copy.toState();
    expect(state.heldBy).toBe(borrower);
    expect(state.ownerId).toBe(owner); // ownership is unchanged by a lend
    expect(state.sharing.isAvailableForAnyExchange()).toBe(false);
    expect(names(copy.pullEvents())).toEqual(["CopyLentOut"]);
  });

  it("returnToOwner restores possession to the owner", () => {
    const copy = acquire();
    copy.lendOut(borrower, NOW);
    copy.pullEvents();
    const result = copy.returnToOwner(LATER);
    expect(result.isOk).toBe(true);
    expect(copy.toState().heldBy).toBe(owner);
    expect(names(copy.pullEvents())).toEqual(["CopyReturnedToOwner"]);
  });

  it("transferTo moves possession to the new owner too", () => {
    const copy = acquire();
    copy.pullEvents();
    copy.transferTo(borrower, LATER);
    expect(copy.toState().heldBy).toBe(borrower);
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

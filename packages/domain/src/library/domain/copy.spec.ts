import { describe, expect, it } from "vitest";
import {
  DomainEvent,
  toCopyId,
  toOwnerId,
  toPuzzleDefinitionId,
} from "../../shared-kernel";
import { Acquisition } from "./acquisition";
import { CatalogSnapshot } from "./catalog-snapshot";
import { Copy, MAX_MISSING_PIECES } from "./copy";
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

  it("defaults to a visible sharing setting (not available for any exchange)", () => {
    const copy = acquire();
    expect(copy.sharing.visibility).toBe("visible");
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

  it("makes a copy private (not offered)", () => {
    const copy = acquire();
    copy.pullEvents();
    const result = copy.updateSharing(
      SharingSetting.create({ visibility: "private" }),
      LATER,
    );
    expect(result.isOk).toBe(true);
    expect(copy.sharing.visibility).toBe("private");
    expect(copy.toState().updatedAt).toBe(LATER);
    expect(names(copy.pullEvents())).toEqual(["CopyMadeUnavailable"]);
  });

  it("offers a private copy: keeps the owner's private choice and is visible while offered", () => {
    const copy = acquire();
    copy.pullEvents();
    const result = copy.updateSharing(
      SharingSetting.create({ visibility: "private", forTrade: true }),
      LATER,
    );
    expect(result.isOk).toBe(true);
    expect(copy.sharing.visibility).toBe("private");
    expect(copy.sharing.effectiveVisibility()).toBe("visible");
    expect(copy.sharing.isAvailableFor("trade")).toBe(true);
    expect(copy.toState().updatedAt).toBe(LATER);
    const events = copy.pullEvents();
    expect(names(events)).toEqual(["CopyMadeAvailable"]);
    expect(events[0]).toBeInstanceOf(CopyMadeAvailable);
  });
});

describe("updateDetails", () => {
  const MARCH = new Date("2025-03-01T12:00:00Z");

  it("records when and how the copy was acquired, keeping the paid price and other details", () => {
    const price = Price.create(1500, "EUR");
    if (!price.isOk) throw new Error("setup failed");
    const result = Copy.acquire({
      id: copyId,
      ownerId: owner,
      snapshot: snapshot(),
      condition: "good",
      acquisition: Acquisition.create({ price: price.value }),
      notes: "corner bent",
      now: NOW,
    });
    if (!result.isOk) throw new Error("setup failed");
    const copy = result.value;
    copy.pullEvents();

    const updated = copy.updateDetails(
      { acquisition: { date: MARCH, source: "bought_used" } },
      LATER,
    );
    expect(updated.isOk).toBe(true);
    const state = copy.toState();
    expect(state.acquisition.date).toEqual(MARCH);
    expect(state.acquisition.source).toBe("bought_used");
    expect(state.acquisition.price).toBe(price.value);
    expect(state.notes).toBe("corner bent");
    expect(state.updatedAt).toBe(LATER);
    expect(names(copy.pullEvents())).toEqual(["CopyDetailsUpdated"]);
  });

  it("a supplied acquisition replaces both date and source, so an omitted one is cleared", () => {
    const copy = acquire();
    copy.updateDetails({ acquisition: { date: MARCH, source: "gift" } }, NOW);
    copy.updateDetails({ acquisition: { source: "trade" } }, LATER);
    expect(copy.toState().acquisition.date).toBeUndefined();
    expect(copy.toState().acquisition.source).toBe("trade");
    copy.updateDetails({ acquisition: {} }, LATER);
    expect(copy.toState().acquisition.source).toBeUndefined();
  });

  it("leaves the acquisition alone when none is supplied", () => {
    const copy = acquire();
    copy.updateDetails({ acquisition: { date: MARCH, source: "gift" } }, NOW);
    copy.updateDetails({ notes: "lovely" }, LATER);
    expect(copy.toState().acquisition.date).toEqual(MARCH);
    expect(copy.toState().acquisition.source).toBe("gift");
  });

  describe("an impossible acquisition date", () => {
    it.each([
      ["not a real date", new Date(NaN)],
      ["from before 1900", new Date("1899-12-31T12:00:00Z")],
      ["more than a year ahead", new Date("2027-06-30T12:00:00Z")],
    ])("refuses one %s and keeps the details as they were", (_, date) => {
      const copy = acquire();
      copy.updateDetails({ acquisition: { date: MARCH, source: "gift" } }, NOW);
      copy.pullEvents();

      const result = copy.updateDetails(
        { acquisition: { date, source: "trade" }, notes: "changed" },
        LATER,
      );

      expect(result.isErr && result.error.code).toBe("InvalidAcquisitionDate");
      expect(copy.toState().acquisition.date).toEqual(MARCH);
      expect(copy.toState().acquisition.source).toBe("gift");
      expect(copy.toState().notes).not.toBe("changed");
      expect(copy.pullEvents()).toEqual([]);
    });

    it("accepts any month of the current year, which the month picker offers", () => {
      const copy = acquire();
      const december = new Date("2026-12-01T12:00:00Z");
      expect(
        copy.updateDetails({ acquisition: { date: december } }, NOW).isOk,
      ).toBe(true);
      expect(copy.toState().acquisition.date).toEqual(december);
    });

    it("refuses one on a new copy", () => {
      const result = Copy.acquire({
        id: copyId,
        ownerId: owner,
        snapshot: snapshot(),
        condition: "good",
        acquisition: Acquisition.create({ date: new Date(NaN) }),
        now: NOW,
      });
      expect(result.isErr && result.error.code).toBe("InvalidAcquisitionDate");
    });
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

  it("resets owner-specific fields: sharing to the visible default, acquisition trade, notes cleared", () => {
    const copy = owned();
    copy.transferTo(newOwner, LATER);
    const state = copy.toState();
    expect(state.sharing.isAvailableForAnyExchange()).toBe(false);
    expect(state.sharing.visibility).toBe("visible");
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
  // A settlement names the owner the deal was made with; the copy moves only away from them.
  it("transfers when the expected previous owner still owns it", () => {
    const copy = owned();
    expect(copy.transferTo(newOwner, LATER, owner).isOk).toBe(true);
    expect(copy.ownerId).toBe(newOwner);
  });

  it("refuses with OwnershipChanged once someone else owns it, changing nothing", () => {
    const copy = owned();
    const before = copy.toState();
    const result = copy.transferTo(newOwner, LATER, toOwnerId("carol"));
    expect(result.isErr && result.error.code).toBe("OwnershipChanged");
    expect(copy.toState()).toEqual(before);
    expect(copy.pullEvents()).toHaveLength(0);
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

  it("lendOut keeps the owner's visibility choice", () => {
    const copy = acquire();
    copy.updateSharing(SharingSetting.create({ visibility: "private" }), NOW);
    copy.lendOut(borrower, LATER);
    expect(copy.sharing.visibility).toBe("private");
  });

  // One loan at a time: a copy someone else holds is not lent out again until it is back.
  it("lendOut refuses with AlreadyLentOut while the copy is out, changing nothing", () => {
    const copy = acquire();
    copy.lendOut(borrower, NOW);
    copy.pullEvents();
    const before = copy.toState();
    const result = copy.lendOut(toOwnerId("carol"), LATER);
    expect(result.isErr && result.error.code).toBe("AlreadyLentOut");
    expect(copy.toState()).toEqual(before);
    expect(copy.pullEvents()).toHaveLength(0);
  });

  it("lendOut works again once the copy is back with its owner", () => {
    const copy = acquire();
    copy.lendOut(borrower, NOW);
    copy.returnToOwner(NOW);
    const carol = toOwnerId("carol");
    expect(copy.lendOut(carol, LATER).isOk).toBe(true);
    expect(copy.heldBy).toBe(carol);
  });

  it("lendOut of a private copy that was offered makes it private again", () => {
    const copy = acquire();
    copy.updateSharing(
      SharingSetting.create({ visibility: "private", forLend: true }),
      NOW,
    );
    copy.lendOut(borrower, LATER);
    expect(copy.sharing.isAvailableForAnyExchange()).toBe(false);
    expect(copy.sharing.effectiveVisibility()).toBe("private");
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

// -1, Infinity and 1e300 used to be stored as they came and returned to anyone reading the copy.
describe("a copy's missing pieces", () => {
  const acquireWith = (missingPiecesCount: number) =>
    Copy.acquire({
      id: copyId,
      ownerId: owner,
      snapshot: snapshot(),
      condition: "good",
      missingPiecesCount,
      now: NOW,
    });
  const invalid = [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1e300,
    MAX_MISSING_PIECES + 1,
  ];

  it.each(invalid)("acquire refuses %p", (count) => {
    const result = acquireWith(count);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidMissingPieces");
  });

  it.each(invalid)("updateDetails refuses %p and keeps the count", (count) => {
    const copy = acquire();
    const result = copy.updateDetails({ missingPiecesCount: count }, LATER);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidMissingPieces");
    expect(copy.toState().missingPiecesCount).toBeUndefined();
  });

  it.each([0, 1, MAX_MISSING_PIECES])("takes %p", (count) => {
    expect(acquireWith(count).isOk).toBe(true);
    const copy = acquire();
    expect(copy.updateDetails({ missingPiecesCount: count }, LATER).isOk).toBe(
      true,
    );
    expect(copy.toState().missingPiecesCount).toBe(count);
  });
});

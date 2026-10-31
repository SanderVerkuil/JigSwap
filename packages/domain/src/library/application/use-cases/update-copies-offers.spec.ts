import { beforeEach, describe, expect, it } from "vitest";
import {
  toCopyId,
  toOwnerId,
  toPuzzleDefinitionId,
} from "../../../shared-kernel";
import {
  CatalogSnapshot,
  Copy,
  CopyId,
  MAX_OFFERS_BATCH,
  OwnerId,
  SharingSetting,
} from "../../domain";
import {
  FakeCopyManagerPolicy,
  FakeCopyReservationPort,
  FixedClock,
  InMemoryCopyRepository,
  RecordingEventPublisher,
} from "../testing";
import { makeUpdateCopiesOffers } from "./update-copies-offers";

// My Puzzles' bulk offer actions: each copy runs the single-copy sharing rules, keeps its owner's
// visibility choice and its other offers, and a copy that can't be changed is skipped (with why)
// instead of failing the whole batch.

const alice = toOwnerId("alice");
const bob = toOwnerId("bob");
const NOW = new Date("2026-10-31T10:00:00Z");

const snapshot = CatalogSnapshot.create({
  puzzleDefinitionId: toPuzzleDefinitionId("def1"),
  title: "Owl",
  pieceCount: 500,
});

describe("makeUpdateCopiesOffers", () => {
  let copies: InMemoryCopyRepository;
  let reservations: FakeCopyReservationPort;
  let managers: FakeCopyManagerPolicy;
  let events: RecordingEventPublisher;

  const run = () =>
    makeUpdateCopiesOffers({
      copies,
      reservations,
      managers,
      events,
      clock: new FixedClock(NOW),
    });

  // Seed a copy owned by `owner` with the given sharing (default: visible, not offered).
  const seedCopy = async (
    id: string,
    {
      owner = alice,
      sharing = SharingSetting.newCopy(),
    }: { owner?: OwnerId; sharing?: SharingSetting } = {},
  ): Promise<CopyId> => {
    const acquired = Copy.acquire({
      id: toCopyId(id),
      ownerId: owner,
      snapshot,
      condition: "good",
      now: NOW,
    });
    if (!acquired.isOk) throw new Error("setup");
    const copy = acquired.value;
    copy.updateSharing(sharing, NOW);
    copy.pullEvents();
    await copies.save(copy);
    return copy.id;
  };

  const sharingOf = async (id: CopyId) => (await copies.findById(id))?.sharing;

  beforeEach(() => {
    copies = new InMemoryCopyRepository();
    reservations = new FakeCopyReservationPort();
    managers = new FakeCopyManagerPolicy();
    events = new RecordingEventPublisher();
  });

  it("offers each copy for swap and keeps the offers it already had", async () => {
    const closed = await seedCopy("closed");
    const lent = await seedCopy("lend", {
      sharing: SharingSetting.create({ visibility: "visible", forLend: true }),
    });

    const result = await run()({
      actingMemberId: alice,
      copyIds: [closed, lent],
      offers: { forTrade: true },
    });

    expect(result.isOk && result.value).toEqual({
      updated: 2,
      unchanged: 0,
      skipped: [],
    });
    expect((await sharingOf(closed))?.forTrade).toBe(true);
    expect((await sharingOf(closed))?.forLend).toBe(false);
    expect((await sharingOf(lent))?.forTrade).toBe(true);
    expect((await sharingOf(lent))?.forLend).toBe(true);
    expect(events.names()).toEqual(["CopyMadeAvailable", "CopyMadeAvailable"]);
  });

  it("keeps a private copy's private choice: visible while offered, private again once withdrawn", async () => {
    const id = await seedCopy("private", {
      sharing: SharingSetting.create({ visibility: "private" }),
    });

    await run()({
      actingMemberId: alice,
      copyIds: [id],
      offers: { forLend: true },
    });
    const offered = await sharingOf(id);
    expect(offered?.visibility).toBe("private");
    expect(offered?.effectiveVisibility()).toBe("visible");

    await run()({
      actingMemberId: alice,
      copyIds: [id],
      offers: { forTrade: false, forLend: false, forSale: false },
    });
    const withdrawn = await sharingOf(id);
    expect(withdrawn?.isAvailableForAnyExchange()).toBe(false);
    expect(withdrawn?.effectiveVisibility()).toBe("private");
  });

  it("withdraws every offer, sale included, and never consults reservations to do so", async () => {
    const id = await seedCopy("all", {
      sharing: SharingSetting.create({
        visibility: "visible",
        forTrade: true,
        forLend: true,
        forSale: true,
      }),
    });
    reservations.reserve(id);

    const result = await run()({
      actingMemberId: alice,
      copyIds: [id],
      offers: { forTrade: false, forLend: false, forSale: false },
    });

    expect(result.isOk && result.value.updated).toBe(1);
    expect((await sharingOf(id))?.isAvailableForAnyExchange()).toBe(false);
    expect(events.names()).toEqual(["CopyMadeUnavailable"]);
  });

  it("leaves a copy that already has the asked offers alone (no write, no event)", async () => {
    const id = await seedCopy("swap", {
      sharing: SharingSetting.create({ visibility: "visible", forTrade: true }),
    });

    const result = await run()({
      actingMemberId: alice,
      copyIds: [id],
      offers: { forTrade: true },
    });

    expect(result.isOk && result.value).toEqual({
      updated: 0,
      unchanged: 1,
      skipped: [],
    });
    expect(events.published).toHaveLength(0);
  });

  it("skips unknown copies and copies the caller may not manage, and changes the rest", async () => {
    const mine = await seedCopy("mine");
    const bobs = await seedCopy("bobs", { owner: bob });
    const ghost = toCopyId("ghost");

    const result = await run()({
      actingMemberId: alice,
      copyIds: [bobs, mine, ghost],
      offers: { forTrade: true },
    });

    expect(result.isOk && result.value).toEqual({
      updated: 1,
      unchanged: 0,
      skipped: [
        { copyId: bobs, reason: "notAllowed" },
        { copyId: ghost, reason: "notAllowed" },
      ],
    });
    expect((await sharingOf(bobs))?.forTrade).toBe(false);
    expect((await sharingOf(mine))?.forTrade).toBe(true);
  });

  it("says notAllowed, not unchanged, for someone else's copy already on offer", async () => {
    const bobs = await seedCopy("bobs", {
      owner: bob,
      sharing: SharingSetting.create({ visibility: "visible", forTrade: true }),
    });

    const result = await run()({
      actingMemberId: alice,
      copyIds: [bobs],
      offers: { forTrade: true },
    });

    expect(result.isOk && result.value).toEqual({
      updated: 0,
      unchanged: 0,
      skipped: [{ copyId: bobs, reason: "notAllowed" }],
    });
  });

  it("lets a member the manager policy vouches for change the copy", async () => {
    const bobs = await seedCopy("bobs", { owner: bob });
    managers.allow(bobs, alice);

    const result = await run()({
      actingMemberId: alice,
      copyIds: [bobs],
      offers: { forLend: true },
    });

    expect(result.isOk && result.value.updated).toBe(1);
    expect((await sharingOf(bobs))?.forLend).toBe(true);
  });

  it("skips a copy an active exchange reserves when offering it", async () => {
    const free = await seedCopy("free");
    const reserved = await seedCopy("reserved");
    reservations.reserve(reserved);

    const result = await run()({
      actingMemberId: alice,
      copyIds: [reserved, free],
      offers: { forTrade: true },
    });

    expect(result.isOk && result.value).toEqual({
      updated: 1,
      unchanged: 0,
      skipped: [{ copyId: reserved, reason: "reserved" }],
    });
    expect((await sharingOf(reserved))?.forTrade).toBe(false);
  });

  it("changes a copy listed twice once", async () => {
    const id = await seedCopy("twice");

    const result = await run()({
      actingMemberId: alice,
      copyIds: [id, id],
      offers: { forTrade: true },
    });

    expect(result.isOk && result.value.updated).toBe(1);
    expect(events.names()).toEqual(["CopyMadeAvailable"]);
  });

  it(`takes up to ${MAX_OFFERS_BATCH} distinct copies and refuses one more before writing anything`, async () => {
    const ids: CopyId[] = [];
    for (let i = 0; i <= MAX_OFFERS_BATCH; i++) {
      ids.push(await seedCopy(`copy-${i}`));
    }

    const tooMany = await run()({
      actingMemberId: alice,
      copyIds: ids,
      offers: { forTrade: true },
    });
    expect(tooMany.isErr).toBe(true);
    if (tooMany.isErr) {
      expect(tooMany.error.code).toBe("OffersBatchTooLarge");
      expect(tooMany.error.message).toBe(
        "At most 100 puzzles can be changed at once",
      );
    }
    expect(events.published).toHaveLength(0);

    const full = await run()({
      actingMemberId: alice,
      // The cap counts distinct copies: a repeat of the first does not push it over.
      copyIds: [...ids.slice(0, MAX_OFFERS_BATCH), ...ids.slice(0, 1)],
      offers: { forTrade: true },
    });
    expect(full.isOk && full.value.updated).toBe(MAX_OFFERS_BATCH);
  });
});

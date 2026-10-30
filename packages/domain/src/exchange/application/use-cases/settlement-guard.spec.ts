import { describe, expect, it } from "vitest";
import { toCopyId, toExchangeId, toMemberId } from "../../../shared-kernel";
import {
  Exchange,
  ExchangeState,
  ExchangeTermsInput,
  MemberId,
  Money,
} from "../../domain";
import { CopyView } from "../ports/out/copy.port";
import { FakeCopyPort } from "../testing";
import { canStillSettle, settlementGuard } from "./settlement-guard";

const alice = toMemberId("alice"); // initiator
const bob = toMemberId("bob"); // recipient, owner of the requested copy
const carol = toMemberId("carol"); // alice's housemate, owner of the offered copy
const dave = toMemberId("dave"); // a later owner
const requestedId = toCopyId("requested");
const offeredId = toCopyId("offered");
const NOW = new Date("2026-06-08T10:00:00Z");

const price = (): Money => {
  const m = Money.create(2500, "EUR");
  if (!m.isOk) throw new Error("setup");
  return m.value;
};

const view = (
  id: CopyView["id"],
  ownerId: MemberId,
  coManagerIds: readonly MemberId[] = [],
): CopyView => ({
  id,
  ownerId,
  coManagerIds,
  availability: { forTrade: false, forSale: false, forLend: false },
});

const proposed = (
  terms: ExchangeTermsInput,
  offeredCopyOwnerId?: MemberId,
): Exchange => {
  const result = Exchange.propose({
    id: toExchangeId("ex-1"),
    initiator: alice,
    recipient: bob,
    requestedCopyId: requestedId,
    terms,
    offeredCopyOwnerId,
    now: NOW,
  });
  if (!result.isOk) throw new Error("setup");
  return result.value;
};

const sale = (): Exchange => proposed({ kind: "sale", price: price() });
const swap = (offeredCopyOwnerId?: MemberId): Exchange =>
  proposed({ kind: "swap", offeredCopyId: offeredId }, offeredCopyOwnerId);

// A hand-crafted state no propose() call produces, to pin which kinds the offered copy counts for.
const rehydrated = (over: Partial<ExchangeState>): Exchange =>
  Exchange.rehydrate({ ...swap(alice).toState(), ...over });

const codeOf = async (
  copies: FakeCopyPort,
  exchange: Exchange,
): Promise<string> => {
  const refusal = await settlementGuard(copies)(exchange);
  return refusal ? refusal.code : "ok";
};

describe("settlementGuard: the requested copy", () => {
  it("passes while the recipient still owns it", async () => {
    const copies = new FakeCopyPort().seed(view(requestedId, bob));
    expect(await codeOf(copies, sale())).toBe("ok");
  });

  it("refuses with CopyNotFound once it is gone", async () => {
    const refusal = await settlementGuard(new FakeCopyPort())(sale());
    expect(refusal?.code).toBe("CopyNotFound");
    expect(refusal?.message).toContain(requestedId);
  });

  it("refuses with RecipientNotOwner once it changed hands", async () => {
    const copies = new FakeCopyPort().seed(view(requestedId, dave));
    const refusal = await settlementGuard(copies)(sale());
    expect(refusal?.code).toBe("RecipientNotOwner");
    expect(refusal?.message).toContain(requestedId);
  });

  it("refuses even when the copy moved to the initiator", async () => {
    // The recipient is no longer the owner, whoever is: the deal was made with them.
    const copies = new FakeCopyPort().seed(view(requestedId, alice));
    expect(await codeOf(copies, sale())).toBe("RecipientNotOwner");
  });
});

describe("settlementGuard: a swap's offered copy", () => {
  const withRequested = () => new FakeCopyPort().seed(view(requestedId, bob));

  it("passes while the initiator still owns it", async () => {
    const copies = withRequested().seed(view(offeredId, alice));
    expect(await codeOf(copies, swap(alice))).toBe("ok");
  });

  it("passes while the initiator still co-manages the recorded owner's copy", async () => {
    const copies = withRequested().seed(view(offeredId, carol, [alice]));
    expect(await codeOf(copies, swap(carol))).toBe("ok");
  });

  it("checks the requested copy first", async () => {
    const copies = new FakeCopyPort().seed(view(requestedId, dave));
    expect(await codeOf(copies, swap(alice))).toBe("RecipientNotOwner");
  });

  it("refuses with CopyNotFound once it is gone", async () => {
    const refusal = await settlementGuard(withRequested())(swap(alice));
    expect(refusal?.code).toBe("CopyNotFound");
    expect(refusal?.message).toContain(offeredId);
  });

  it("refuses with OfferedCopyNotOwned once the initiator no longer co-manages it", async () => {
    // The housemate left (or was removed from) the owner's household.
    const copies = withRequested().seed(view(offeredId, carol, []));
    const refusal = await settlementGuard(copies)(swap(carol));
    expect(refusal?.code).toBe("OfferedCopyNotOwned");
    expect(refusal?.message).toContain(offeredId);
  });

  it("refuses with OfferedCopyNotOwned once it has another owner than recorded, even one the initiator may offer for", async () => {
    // Carol sold it to Dave, whose copies Alice also co-manages: still not the copy that was offered.
    const copies = withRequested().seed(view(offeredId, dave, [alice]));
    expect(await codeOf(copies, swap(carol))).toBe("OfferedCopyNotOwned");
  });

  it("refuses with OfferedCopyNotOwned once it belongs to the initiator instead of the recorded owner", async () => {
    const copies = withRequested().seed(view(offeredId, alice));
    expect(await codeOf(copies, swap(carol))).toBe("OfferedCopyNotOwned");
  });

  it("refuses with OfferedCopyNotOwned once it belongs to the recipient", async () => {
    const copies = withRequested().seed(view(offeredId, bob, [alice]));
    expect(await codeOf(copies, swap())).toBe("OfferedCopyNotOwned");
  });

  it("falls back to the offer rule alone on a swap proposed before the owner was recorded", async () => {
    const copies = withRequested().seed(view(offeredId, dave, [alice]));
    expect(await codeOf(copies, swap())).toBe("ok");
    copies.seed(view(offeredId, dave, []));
    expect(await codeOf(copies, swap())).toBe("OfferedCopyNotOwned");
  });

  it("ignores an offered copy on any kind but swap, as settlement does", async () => {
    // Nothing seeded for the offered copy: a check would answer CopyNotFound.
    const exchange = rehydrated({ kind: "sale", price: price() });
    expect(await codeOf(withRequested(), exchange)).toBe("ok");
  });

  it("checks only the requested copy for a swap without an offered copy", async () => {
    const exchange = rehydrated({ offeredCopyId: undefined });
    expect(await codeOf(withRequested(), exchange)).toBe("ok");
  });
});

// A copy out on loan is at the borrower's: no deal on it may be accepted or settle until it is back.
describe("settlementGuard: a copy out on loan", () => {
  const lentTo = (copy: CopyView, holder: MemberId): CopyView => ({
    ...copy,
    heldBy: holder,
  });

  it("refuses with CopyReserved while the requested copy is out on loan", async () => {
    const copies = new FakeCopyPort().seed(
      lentTo(view(requestedId, bob), dave),
    );
    const refusal = await settlementGuard(copies)(sale());
    expect(refusal?.code).toBe("CopyReserved");
    expect(refusal?.message).toContain(requestedId);
  });

  it("refuses with CopyReserved while a swap's offered copy is out on loan", async () => {
    const copies = new FakeCopyPort()
      .seed(view(requestedId, bob))
      .seed(lentTo(view(offeredId, alice), dave));
    const refusal = await settlementGuard(copies)(swap(alice));
    expect(refusal?.code).toBe("CopyReserved");
    expect(refusal?.message).toContain(offeredId);
  });

  it("passes while each copy is held by its owner", async () => {
    const copies = new FakeCopyPort()
      .seed(lentTo(view(requestedId, bob), bob))
      .seed(lentTo(view(offeredId, carol, [alice]), carol));
    expect(await codeOf(copies, swap(carol))).toBe("ok");
  });

  it("answers a copy that changed hands before one out on loan", async () => {
    const copies = new FakeCopyPort()
      .seed(lentTo(view(requestedId, bob), dave))
      .seed(view(offeredId, carol, []));
    expect(await codeOf(copies, swap(carol))).toBe("OfferedCopyNotOwned");
  });

  it("ignores a loan on an offered copy the deal doesn't move", async () => {
    const exchange = rehydrated({ kind: "sale", price: price() });
    const copies = new FakeCopyPort()
      .seed(view(requestedId, bob))
      .seed(lentTo(view(offeredId, alice), dave));
    expect(await codeOf(copies, exchange)).toBe("ok");
  });
});

// The reservation rule's notion of a live deal: exactly the deals the guard would let settle.
describe("canStillSettle", () => {
  it("holds while every copy the deal names is still in place", async () => {
    const copies = new FakeCopyPort()
      .seed(view(requestedId, bob))
      .seed(view(offeredId, carol, [alice]));
    expect(await canStillSettle(copies)(swap(carol))).toBe(true);
  });

  it("no longer holds once the requested copy changed hands", async () => {
    const copies = new FakeCopyPort().seed(view(requestedId, dave));
    expect(await canStillSettle(copies)(sale())).toBe(false);
  });

  it("no longer holds while a copy is out on loan", async () => {
    const copies = new FakeCopyPort().seed({
      ...view(requestedId, bob),
      heldBy: dave,
    });
    expect(await canStillSettle(copies)(sale())).toBe(false);
  });

  it("no longer holds once the offered copy can't be offered, though the requested one is in place", async () => {
    const copies = new FakeCopyPort()
      .seed(view(requestedId, bob))
      .seed(view(offeredId, carol, []));
    expect(await canStillSettle(copies)(swap(carol))).toBe(false);
  });
});

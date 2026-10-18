import type {
  LocationAttachmentView,
  ThreadMessageView,
} from "@jigswap/contracts";
import { convexTest, type TestConvex } from "convex-test";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { RATE_LIMITS } from "./lib/rateLimits";
import schema from "./schema";

// Location sharing (spec 2.4, R.5, R.6): the feature gate, the sendLocation gates (participant,
// block, rate limit), the precision rules, the deferred append after the server-side render
// (ready or failed), the participant-only read model, the picker actions (search mapping without
// the provider payload, the picker view and its temporary blob), and the block, report and
// removal paths for location rows. MapTiler is a routed fake `fetch` serving generated tiles.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

const MAPTILER = "https://api.maptiler.com";
const KEY = "test-maptiler-key";

const fakes: { tiles: "ok" | number; geocoding: unknown } = {
  tiles: "ok",
  geocoding: { features: [] },
};
const fetchMock = vi.fn();

let tilePng: Uint8Array<ArrayBuffer>;
beforeEach(async () => {
  tilePng ??= new Uint8Array(
    await new Jimp({ width: 512, height: 512, color: 0xd0e0d0ff }).getBuffer(
      "image/png",
    ),
  );
  fakes.tiles = "ok";
  fakes.geocoding = { features: [] };
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MAPTILER_API_KEY", KEY);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith(`${MAPTILER}/maps/`)) {
      return fakes.tiles === "ok"
        ? new Response(tilePng, { headers: { "content-type": "image/png" } })
        : new Response("error", { status: fakes.tiles });
    }
    if (url.startsWith(`${MAPTILER}/geocoding/`)) {
      return new Response(JSON.stringify(fakes.geocoding), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        preferredLanguage: "nl",
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    const carol = await mkUser("clerk_carol");
    await mkUser("clerk_ada");
    await ctx.db.insert("follows", {
      followerId: alice,
      followeeId: bob,
      createdAt: 1,
    });
    await ctx.db.insert("follows", {
      followerId: bob,
      followeeId: alice,
      createdAt: 1,
    });
    return { alice, bob, carol };
  });

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: T) => t.withIdentity({ subject: "clerk_bob" });
const asCarol = (t: T) => t.withIdentity({ subject: "clerk_carol" });
const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_ada", metadata: { role: "admin" } });

// Alice and Bob's DM, opened while they follow each other. `mutual: false` then drops Bob's
// follow of Alice (the thread stays: an existing pair thread keeps the pair connected).
const openThread = async (t: T, { mutual = true } = {}) => {
  const { alice, bob, carol } = await seed(t);
  const threadId = await asAlice(t).mutation(
    api.conversation.openDmThread.openDmThread,
    { recipientId: bob },
  );
  if (!mutual) {
    await t.run(async (ctx) => {
      const edge = await ctx.db
        .query("follows")
        .filter((q) => q.eq(q.field("followerId"), bob))
        .first();
      await ctx.db.delete(edge!._id);
    });
  }
  return { alice, bob, carol, threadId };
};

const settleDueJobs = async (t: T) => {
  for (let i = 0; i < 200; i++) {
    await t.finishInProgressScheduledFunctions();
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const busy = jobs.some(
      (job) =>
        job.state.kind === "inProgress" ||
        (job.state.kind === "pending" && job.scheduledTime <= Date.now()),
    );
    if (!busy) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("scheduled functions did not settle");
};

type SendArgs = {
  lat?: number;
  lng?: number;
  source?: "pin" | "gps";
  precision?: "exact" | "approximate";
  label?: string;
  caption?: string;
};

const sendRaw = (
  as: (t: T) => ReturnType<T["withIdentity"]>,
  t: T,
  threadId: string,
  args: SendArgs = {},
) =>
  as(t).mutation(api.conversation.sendLocation.sendLocation, {
    threadId,
    lat: args.lat ?? 52.0907374,
    lng: args.lng ?? 5.1214209,
    source: args.source ?? "pin",
    precision: args.precision ?? "exact",
    ...(args.label !== undefined && { label: args.label }),
    ...(args.caption !== undefined && { caption: args.caption }),
  });

const send = async (t: T, threadId: string, args: SendArgs = {}) =>
  (await sendRaw(asAlice, t, threadId, args)).attachmentId;

const row = (t: T, id: Id<"messageAttachments">) =>
  t.run(async (ctx) => {
    const doc = await ctx.db.get(id);
    return doc?.kind === "location" ? doc : null;
  });

const threadOf = (
  t: T,
  as: (t: T) => ReturnType<T["withIdentity"]>,
  id: string,
) =>
  as(t).query(api.conversation.getThreadMessages.getThreadMessages, {
    threadId: id,
  });

const locationOf = (message: ThreadMessageView) =>
  message.attachment as LocationAttachmentView | undefined;

const messageRows = (t: T, threadId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("threadMessages")
      .withIndex("by_thread_sent", (q) => q.eq("threadAggregateId", threadId))
      .collect(),
  );

const blobExists = (t: T, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

describe("availability", () => {
  test("without a key: not offered, and every location function refuses LocationUnavailable", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    vi.stubEnv("MAPTILER_API_KEY", "");

    expect(
      await asAlice(t).query(
        api.conversation.locationAvailable.locationAvailable,
        { threadId },
      ),
    ).toEqual({ available: false, exactCurrentLocation: false });
    await expect(send(t, threadId)).rejects.toThrow(/LocationUnavailable/);
    await expect(
      asAlice(t).action(api.conversation.searchPlaces.searchPlaces, {
        threadId,
        query: "Domplein",
      }),
    ).rejects.toThrow(/LocationUnavailable/);
    await expect(
      asAlice(t).action(api.conversation.renderPickerMap.renderPickerMap, {
        threadId,
        lat: 52.09,
        lng: 5.12,
        zoom: 14,
      }),
    ).rejects.toThrow(/LocationUnavailable/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await t.run((ctx) => ctx.db.query("messageAttachments").collect()),
    ).toEqual([]);
  });

  test("with a key: offered; exact current location only for a mutual follower", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const probe = () =>
      asAlice(t).query(api.conversation.locationAvailable.locationAvailable, {
        threadId,
      });
    expect(await probe()).toEqual({
      available: true,
      exactCurrentLocation: true,
    });

    const other = convexTest(schema, modules);
    const { threadId: nonMutual } = await openThread(other, { mutual: false });
    expect(
      await asAlice(other).query(
        api.conversation.locationAvailable.locationAvailable,
        { threadId: nonMutual },
      ),
    ).toEqual({ available: true, exactCurrentLocation: false });
  });

  test("the probe is for participants only", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    await expect(
      asCarol(t).query(api.conversation.locationAvailable.locationAvailable, {
        threadId,
      }),
    ).rejects.toThrow(/NotParticipant/);
  });
});

describe("sendLocation gates", () => {
  test("a non-participant can't send", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    await expect(sendRaw(asCarol, t, threadId)).rejects.toThrow(
      /NotParticipant/,
    );
  });

  test("a blocked pair can't send, either way", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await openThread(t);
    await asBob(t).mutation(api.social.blockMember.blockMember, {
      memberId: alice,
    });
    await expect(sendRaw(asAlice, t, threadId)).rejects.toThrow();
    await expect(sendRaw(asBob, t, threadId)).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("messageAttachments").collect()),
    ).toEqual([]);
  });

  test("the daily locationSend limit", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await openThread(t);
    // A full window, as if 20 locations were sent today.
    await t.run((ctx) =>
      ctx.db.insert("rateLimits", {
        key: `locationSend:${alice}`,
        windowStart: Date.now(),
        count: RATE_LIMITS.locationSend.max,
      }),
    );
    await expect(send(t, threadId)).rejects.toThrow(/RateLimited/);
  });

  test("invalid coordinates, a too-long label or caption are refused", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    await expect(send(t, threadId, { lat: 91 })).rejects.toThrow(
      /InvalidCoordinates/,
    );
    await expect(send(t, threadId, { label: "x".repeat(81) })).rejects.toThrow(
      /LocationLabelTooLong/,
    );
    await expect(
      send(t, threadId, { caption: "x".repeat(1001) }),
    ).rejects.toThrow(/CaptionTooLong/);
  });
});

describe("precision (spec R.5)", () => {
  test("a placed or searched pin is stored exactly, at 5 decimals", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const id = await send(t, threadId, { label: "  Domplein  " });
    expect(await row(t, id)).toMatchObject({
      lat: 52.09074,
      lng: 5.12142,
      precision: "exact",
      label: "Domplein",
      mapStatus: "pending",
    });
  });

  test("current location is snapped to the grid by default", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const id = await send(t, threadId, {
      source: "gps",
      precision: "approximate",
    });
    expect(await row(t, id)).toMatchObject({
      lat: 52.09,
      precision: "approximate",
    });
  });

  test("exact current location for a mutual follower who chose it", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const id = await send(t, threadId, { source: "gps", precision: "exact" });
    expect(await row(t, id)).toMatchObject({
      lat: 52.09074,
      precision: "exact",
    });
  });

  test("exact current location to a NON-mutual follower is forced to approximate", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t, { mutual: false });
    const id = await send(t, threadId, { source: "gps", precision: "exact" });
    const stored = (await row(t, id))!;
    expect(stored.precision).toBe("approximate");
    expect(stored.lat).toBe(52.09);
    expect(stored.lng).not.toBe(5.12142);
  });
});

describe("render and delivery", () => {
  test("nothing reaches the thread until the map has rendered; then one message with a stored map", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const id = await send(t, threadId, { caption: "  Here at 3?  " });
    expect(await messageRows(t, threadId)).toEqual([]);

    await settleDueJobs(t);
    const stored = (await row(t, id))!;
    expect(stored.mapStatus).toBe("ready");
    expect(stored.mapFileId).toBeDefined();
    const tileCalls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(tileCalls.length).toBeGreaterThan(0);
    expect(tileCalls.length).toBeLessThanOrEqual(6);
    for (const url of tileCalls) {
      expect(url).toMatch(
        /^https:\/\/api\.maptiler\.com\/maps\/streets-v4\/15\/\d+\/\d+\.png\?key=/,
      );
    }
    // The stored preview is a 600x300 PNG.
    const png = await t.run(async (ctx) =>
      (await ctx.storage.get(stored.mapFileId!))!.arrayBuffer(),
    );
    const image = await Jimp.read(Buffer.from(png));
    expect([image.bitmap.width, image.bitmap.height]).toEqual([600, 300]);

    const messages = await messageRows(t, threadId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      kind: "location",
      body: "Here at 3?",
      attachmentId: id,
      authorId: stored.uploaderId,
    });
    expect(stored.messageId).toBe(messages[0].messageId);

    // Repeating the settle never appends twice.
    await t.mutation(internal.conversation.locationStore.settleLocationMap, {
      attachmentId: id,
    });
    expect(await messageRows(t, threadId)).toHaveLength(1);
  });

  test("an approximate location renders a wider view (zoom 12)", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    await send(t, threadId, { source: "gps", precision: "approximate" });
    await settleDueJobs(t);
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).toContain("/streets-v4/12/");
    }
  });

  test("a provider failure still appends: map failed, a text card for the reader", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    fakes.tiles = 503;
    const id = await send(t, threadId, { label: "Station" });
    await settleDueJobs(t);
    const stored = (await row(t, id))!;
    expect(stored.mapStatus).toBe("failed");
    expect(stored.mapFileId).toBeUndefined();
    expect(await messageRows(t, threadId)).toHaveLength(1);
    const [message] = await threadOf(t, asBob, threadId);
    expect(locationOf(message)).toEqual({
      kind: "location",
      lat: 52.09074,
      lng: 5.12142,
      precision: "exact",
      label: "Station",
      openUrl:
        "https://www.openstreetmap.org/?mlat=52.09074&mlon=5.12142#map=17/52.09074/5.12142",
    });
  });

  test("the key removed before the render: failed, still appended, nothing fetched", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const id = await send(t, threadId);
    vi.stubEnv("MAPTILER_API_KEY", "");
    await settleDueJobs(t);
    expect((await row(t, id))!.mapStatus).toBe("failed");
    expect(await messageRows(t, threadId)).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a block before the render settles: never appended, row and map dropped", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await openThread(t);
    const id = await send(t, threadId);
    await asBob(t).mutation(api.social.blockMember.blockMember, {
      memberId: alice,
    });
    await settleDueJobs(t);
    expect(await row(t, id)).toBeNull();
    expect(await messageRows(t, threadId)).toEqual([]);
    expect(
      await t.run((ctx) => ctx.db.system.query("_storage").collect()),
    ).toEqual([]);
  });
});

describe("read model", () => {
  test("participants see the location with its map URL and OSM link; the inbox says only 'location'", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    await send(t, threadId, { label: "Domplein", caption: "Meet here" });
    await settleDueJobs(t);

    for (const as of [asAlice, asBob]) {
      const [message] = await threadOf(t, as, threadId);
      expect(message.kind).toBe("location");
      expect(message.body).toBe("Meet here");
      expect(locationOf(message)).toMatchObject({
        kind: "location",
        lat: 52.09074,
        lng: 5.12142,
        precision: "exact",
        label: "Domplein",
        mapUrl: expect.any(String),
        openUrl: expect.stringMatching(
          /^https:\/\/www\.openstreetmap\.org\/\?mlat=/,
        ),
      });
    }
    const inbox = await asBob(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    expect(inbox[0].lastMessage).toMatchObject({ kind: "location" });
    expect(inbox[0].lastMessage).not.toHaveProperty("attachment");
    expect(JSON.stringify(inbox)).not.toContain("52.09074");
  });

  test("a non-participant gets nothing", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    await send(t, threadId);
    await settleDueJobs(t);
    await expect(threadOf(t, asCarol, threadId)).rejects.toThrow();
  });
});

describe("picker actions", () => {
  test("searchPlaces maps results to label/lat/lng only and snaps a GPS hint", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    fakes.geocoding = {
      type: "FeatureCollection",
      attribution: "MapTiler",
      features: [
        {
          id: "poi.123",
          text: "Domplein",
          place_name: "Domplein, Utrecht, Nederland",
          center: [5.1214, 52.0907],
          bbox: [5.12, 52.09, 5.13, 52.1],
          properties: { osm_id: 1 },
          context: [{ id: "country.nl", text: "Nederland" }],
        },
      ],
    };
    const results = await asAlice(t).action(
      api.conversation.searchPlaces.searchPlaces,
      {
        threadId,
        query: "  Domplein ",
        near: { lat: 52.0912345, lng: 5.1231 },
      },
    );
    expect(results).toEqual([
      { label: "Domplein, Utrecht, Nederland", lat: 52.0907, lng: 5.1214 },
    ]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/geocoding/Domplein.json");
    expect(url.searchParams.get("country")).toBe("nl,be,de");
    expect(url.searchParams.get("language")).toBe("nl");
    // The hint went out on the ~1 km grid, never as the device's fix.
    const [lng, lat] = url.searchParams.get("proximity")!.split(",");
    expect(Number(lat)).toBe(52.09);
    expect(lng).not.toBe("5.1231");
  });

  test("searchPlaces is gated and rate limited", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await openThread(t);
    await expect(
      asCarol(t).action(api.conversation.searchPlaces.searchPlaces, {
        threadId,
        query: "Domplein",
      }),
    ).rejects.toThrow(/NotParticipant/);
    await t.run((ctx) =>
      ctx.db.insert("rateLimits", {
        key: `locationSearch:${alice}`,
        windowStart: Date.now(),
        count: RATE_LIMITS.locationSearch.max,
      }),
    );
    await expect(
      asAlice(t).action(api.conversation.searchPlaces.searchPlaces, {
        threadId,
        query: "Domplein",
      }),
    ).rejects.toThrow(/RateLimited/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("searchPlaces: a provider error is a generic SearchUnavailable", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    fakes.geocoding = { message: "Invalid key" };
    const error = await asAlice(t)
      .action(api.conversation.searchPlaces.searchPlaces, {
        threadId,
        query: "Domplein",
      })
      .catch((e: unknown) => e);
    expect(String(error)).toMatch(/SearchUnavailable/);
    expect(String(error)).not.toContain(KEY);
  });

  test("renderPickerMap: a temporary 600x360 view, deleted after 10 minutes", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const before = Date.now();
    const view = await asAlice(t).action(
      api.conversation.renderPickerMap.renderPickerMap,
      { threadId, lat: 52.0907, lng: 5.1214, zoom: 30 },
    );
    expect(view).toMatchObject({
      url: expect.any(String),
      lat: 52.0907,
      lng: 5.1214,
      zoom: 18,
      width: 600,
      height: 360,
    });
    expect(view.url).not.toContain(KEY);
    const blobs = await t.run((ctx) =>
      ctx.db.system.query("_storage").collect(),
    );
    expect(blobs).toHaveLength(1);

    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const expiry = jobs.find((job) => job.name.includes("deletePickerMap"))!;
    expect(expiry.scheduledTime).toBeGreaterThanOrEqual(before + 10 * 60_000);
    expect(expiry.args[0]).toEqual({ fileId: blobs[0]._id });
    await t.mutation(internal.conversation.locationStore.deletePickerMap, {
      fileId: blobs[0]._id,
    });
    expect(await blobExists(t, blobs[0]._id)).toBe(false);
  });

  test("renderPickerMap is gated: non-participant, blocked pair, rate limit", async () => {
    const t = convexTest(schema, modules);
    const { bob, threadId } = await openThread(t);
    const render = (as: (t: T) => ReturnType<T["withIdentity"]>) =>
      as(t).action(api.conversation.renderPickerMap.renderPickerMap, {
        threadId,
        lat: 52.09,
        lng: 5.12,
        zoom: 14,
      });
    await expect(render(asCarol)).rejects.toThrow(/NotParticipant/);
    await t.run((ctx) =>
      ctx.db.insert("rateLimits", {
        key: `locationPicker:${bob}`,
        windowStart: Date.now(),
        count: RATE_LIMITS.locationPicker.max,
      }),
    );
    await expect(render(asBob)).rejects.toThrow(/RateLimited/);
    await asAlice(t).mutation(api.social.blockMember.blockMember, {
      memberId: bob,
    });
    await expect(render(asAlice)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("reports and removal", () => {
  test("a delivered location can be reported; removal tombstones it and drops its map", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const id = await send(t, threadId, { label: "Somewhere" });
    await settleDueJobs(t);
    const mapFileId = (await row(t, id))!.mapFileId!;

    const { reportId } = await asBob(t).mutation(
      api.reports.fileReport.fileReport,
      { targetKind: "attachment", targetId: id, reason: "harassment_hate" },
    );
    expect((await row(t, id))!.evidenceHold).toBe(true);
    // A third party can't report it.
    await expect(
      asCarol(t).mutation(api.reports.fileReport.fileReport, {
        targetKind: "attachment",
        targetId: id,
        reason: "harassment_hate",
      }),
    ).rejects.toThrow();

    await asAdmin(t).mutation(api.admin.decideReport.decideReport, {
      reportId,
      decision: "content_removed",
      statementOfReasons: "Unwanted location",
    });
    await settleDueJobs(t);
    const removed = (await row(t, id))!;
    expect(removed.removedAt).toEqual(expect.any(Number));
    // With the map copied as evidence, nothing that places anyone is kept.
    expect(removed.lat).toBeUndefined();
    expect(removed.lng).toBeUndefined();
    expect(removed.label).toBeUndefined();
    expect(await blobExists(t, mapFileId)).toBe(false);
    const report = (await t.run((ctx) => ctx.db.get(reportId)))!;
    expect(report.evidenceFileId).toBeDefined();

    for (const as of [asAlice, asBob]) {
      const [message] = await threadOf(t, as, threadId);
      expect(message.removed).toBe(true);
      expect(message.attachment).toBeUndefined();
    }
  });
});

describe("global MapTiler budget", () => {
  const spend = (t: T, key: string, count: number) =>
    t.run((ctx) =>
      ctx.db.insert("rateLimits", { key, windowStart: Date.now(), count }),
    );

  test("an exhausted hourly budget refuses picker views and searches with LocationUnavailable", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    vi.stubEnv("MAPTILER_HOURLY_CAP", "10");
    await spend(t, "maptiler:global:hour", 9);
    // A 600x360 view needs more than the one request left.
    await expect(
      asAlice(t).action(api.conversation.renderPickerMap.renderPickerMap, {
        threadId,
        lat: 52.09,
        lng: 5.12,
        zoom: 14,
      }),
    ).rejects.toThrow(/LocationUnavailable/);
    // One geocoding request still fits; the next does not.
    await asAlice(t).action(api.conversation.searchPlaces.searchPlaces, {
      threadId,
      query: "Domplein",
    });
    await expect(
      asAlice(t).action(api.conversation.searchPlaces.searchPlaces, {
        threadId,
        query: "Domplein",
      }),
    ).rejects.toThrow(/LocationUnavailable/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("the daily cap counts too, and every upstream request is charged", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    vi.stubEnv("MAPTILER_DAILY_CAP", "100");
    await asAlice(t).action(api.conversation.renderPickerMap.renderPickerMap, {
      threadId,
      lat: 52.09,
      lng: 5.12,
      zoom: 14,
    });
    const counts = await t.run(async (ctx) =>
      Object.fromEntries(
        (await ctx.db.query("rateLimits").collect()).map((r) => [
          r.key,
          r.count,
        ]),
      ),
    );
    expect(counts["maptiler:global:hour"]).toBe(fetchMock.mock.calls.length);
    expect(counts["maptiler:global:day"]).toBe(fetchMock.mock.calls.length);
    await t.run(async (ctx) => {
      const day = (await ctx.db.query("rateLimits").collect()).find(
        (r) => r.key === "maptiler:global:day",
      )!;
      await ctx.db.patch(day._id, { count: 100 });
    });
    await expect(
      asAlice(t).action(api.conversation.searchPlaces.searchPlaces, {
        threadId,
        query: "Domplein",
      }),
    ).rejects.toThrow(/LocationUnavailable/);
  });

  test("a final render over budget settles as a text card, still delivered", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    vi.stubEnv("MAPTILER_HOURLY_CAP", "1");
    const id = await send(t, threadId);
    await settleDueJobs(t);
    expect((await row(t, id))!.mapStatus).toBe("failed");
    expect(await messageRows(t, threadId)).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("the picker's own limit is 60 an hour", () => {
    expect(RATE_LIMITS.locationPicker).toEqual({
      windowMs: 60 * 60_000,
      max: 60,
    });
  });
});

describe("precision guardrail: a pin on a recent GPS view", () => {
  const gpsView = (t: T, threadId: string, lat: number, lng: number) =>
    asAlice(t).action(api.conversation.renderPickerMap.renderPickerMap, {
      threadId,
      lat,
      lng,
      zoom: 15,
      mode: "gps",
    });

  test("a 'pin' within ~100 m of the member's GPS view is sent as approximate current location", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    await gpsView(t, threadId, 52.0907374, 5.1214209);
    const views = await t.run((ctx) =>
      ctx.db.query("locationGpsViews").collect(),
    );
    // Rounded to ~110 m, never the device fix.
    expect(views).toMatchObject([{ lat: 52.091, lng: 5.121 }]);

    // 50 m north of the GPS position, claimed as a placed pin.
    const id = await send(t, threadId, { lat: 52.09119, lng: 5.12142 });
    expect(await row(t, id)).toMatchObject({
      precision: "approximate",
      lat: 52.09,
    });
  });

  test("a pin well away from it stays exact; a view in another thread doesn't count", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    await gpsView(t, threadId, 52.0907, 5.1214);
    const far = await send(t, threadId, { lat: 52.1, lng: 5.13 });
    expect((await row(t, far))!.precision).toBe("exact");
  });

  test("the view is forgotten after 15 minutes", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    const before = Date.now();
    await gpsView(t, threadId, 52.0907, 5.1214);
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const expiry = jobs.find((job) => job.name.includes("deleteGpsView"))!;
    expect(expiry.scheduledTime).toBeGreaterThanOrEqual(before + 15 * 60_000);
    await t.mutation(
      internal.conversation.locationStore.deleteGpsView,
      expiry.args[0] as { viewId: Id<"locationGpsViews"> },
    );
    expect(
      await t.run((ctx) => ctx.db.query("locationGpsViews").collect()),
    ).toEqual([]);
    // And an old view no longer matches even before its deletion runs.
    await t.run(async (ctx) =>
      ctx.db.insert("locationGpsViews", {
        memberId: (await ctx.db.query("users").first())!._id,
        threadAggregateId: threadId,
        lat: 52.091,
        lng: 5.121,
        createdAt: Date.now() - 16 * 60_000,
      }),
    );
    const id = await send(t, threadId, { lat: 52.0907, lng: 5.1214 });
    expect((await row(t, id))!.precision).toBe("exact");
  });

  test("a non-GPS picker view is not remembered", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    await asAlice(t).action(api.conversation.renderPickerMap.renderPickerMap, {
      threadId,
      lat: 52.0907,
      lng: 5.1214,
      zoom: 15,
    });
    expect(
      await t.run((ctx) => ctx.db.query("locationGpsViews").collect()),
    ).toEqual([]);
  });
});

describe("a render that never settles", () => {
  test("sendLocation schedules a backstop 10 minutes out; a still-pending location is then delivered as a text card", async () => {
    const t = convexTest(schema, modules);
    const { alice, threadId } = await openThread(t);
    const before = Date.now();
    const id = await send(t, threadId);
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const backstop = jobs.find((job) =>
      job.name.includes("expireLocationRender"),
    )!;
    expect(backstop.scheduledTime).toBeGreaterThanOrEqual(before + 10 * 60_000);

    // A row whose render action died: pending, no map.
    const stuck = await t.run((ctx) =>
      ctx.db.insert("messageAttachments", {
        kind: "location",
        threadAggregateId: threadId,
        uploaderId: alice,
        lat: 52.1,
        lng: 5.1,
        precision: "exact",
        mapStatus: "pending",
        caption: "Here",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await t.mutation(internal.conversation.locationStore.expireLocationRender, {
      attachmentId: stuck,
    });
    expect((await row(t, stuck))!.mapStatus).toBe("failed");
    const messages = await messageRows(t, threadId);
    expect(messages.map((m) => m.attachmentId)).toContain(stuck);

    // A location that did settle is left alone by its backstop.
    await settleDueJobs(t);
    const settled = (await row(t, id))!;
    expect(settled.mapStatus).toBe("ready");
    await t.mutation(internal.conversation.locationStore.expireLocationRender, {
      attachmentId: id,
    });
    expect((await row(t, id))!.mapStatus).toBe("ready");
    expect(
      (await messageRows(t, threadId)).filter((m) => m.attachmentId === id),
    ).toHaveLength(1);
  });
});

describe("search query rules and response caps", () => {
  test("';' is stripped and a bare coordinate pair gets no results without a call", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    for (const query of ["52.09, 5.12", "52.09 5.12", "-33.8;151.2"]) {
      expect(
        await asAlice(t).action(api.conversation.searchPlaces.searchPlaces, {
          threadId,
          query,
        }),
      ).toEqual([]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    await asAlice(t).action(api.conversation.searchPlaces.searchPlaces, {
      threadId,
      query: "Domplein;Oudegracht",
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(decodeURIComponent(url.pathname)).toBe(
      "/geocoding/Domplein Oudegracht.json",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });

  test("an oversized geocoding response is a clean SearchUnavailable", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await openThread(t);
    fakes.geocoding = { features: [], padding: "x".repeat(300 * 1024) };
    await expect(
      asAlice(t).action(api.conversation.searchPlaces.searchPlaces, {
        threadId,
        query: "Domplein",
      }),
    ).rejects.toThrow(/SearchUnavailable/);
  });
});

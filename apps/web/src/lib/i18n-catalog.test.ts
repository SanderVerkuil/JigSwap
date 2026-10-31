// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale, Messages } from "./i18n";

const mocks = vi.hoisted(() => ({
  getMessages: vi.fn<(input: { data: Locale }) => Promise<Messages>>(),
}));

vi.mock("./i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./i18n")>()),
  getMessages: mocks.getMessages,
}));

const catalogs: Record<Locale, Messages> = {
  en: { titles: { home: "Home" } },
  nl: { titles: { home: "Start" } },
};
// What the server function answers: in dev that is the catalog merged over source.json.
const serverCatalogs: Record<Locale, Messages> = {
  en: { titles: { home: "Home" }, onlyInSource: "Source" },
  nl: { titles: { home: "Start" }, onlyInSource: "Source" },
};

// Fresh module state (the per-locale cache) per test.
async function loadModule() {
  vi.resetModules();
  return import("./i18n-catalog");
}

// Serves each catalog file by URL; `fail` makes every request answer 503.
function stubFetch({ fail = false } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const locale = (["en", "nl"] as const).find((l) =>
      url.endsWith(`/${l}.json`),
    );
    if (fail || !locale) return new Response("unavailable", { status: 503 });
    return Response.json(catalogs[locale]);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("DEV", false);
  mocks.getMessages.mockReset();
  mocks.getMessages.mockImplementation(
    async ({ data }) => serverCatalogs[data],
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("catalogUrl", () => {
  it("points at each locale's own catalog file", async () => {
    const { catalogUrl } = await loadModule();
    expect(catalogUrl("en")).toMatch(/\/en\.json$/);
    expect(catalogUrl("nl")).toMatch(/\/nl\.json$/);
  });
});

describe("catalogPreloadLinks", () => {
  it("preloads the locale's catalog with the server-rendered document", async () => {
    vi.stubGlobal("window", undefined);
    const { catalogPreloadLinks, catalogUrl } = await loadModule();
    expect(catalogPreloadLinks("nl")).toEqual([
      {
        rel: "preload",
        as: "fetch",
        href: catalogUrl("nl"),
        crossOrigin: "anonymous",
      },
    ]);
  });

  it("preloads nothing in the browser, where the catalog has loaded before head() runs", async () => {
    const { catalogPreloadLinks } = await loadModule();
    expect(catalogPreloadLinks("nl")).toEqual([]);
  });

  it("preloads nothing without a locale or in dev, where the server sends the catalog", async () => {
    vi.stubGlobal("window", undefined);
    const { catalogPreloadLinks } = await loadModule();
    expect(catalogPreloadLinks(undefined)).toEqual([]);
    vi.stubEnv("DEV", true);
    expect(catalogPreloadLinks("nl")).toEqual([]);
  });
});

describe("loadCatalog in the browser", () => {
  it("has no messages for a locale until its catalog has loaded", async () => {
    stubFetch();
    const { messagesFor } = await loadModule();
    expect(messagesFor("nl")).toBeUndefined();
  });

  it("fetches each locale's catalog file once and keeps it per locale", async () => {
    const fetchMock = stubFetch();
    const { loadCatalog, messagesFor, catalogUrl } = await loadModule();

    const [first, second] = await Promise.all([
      loadCatalog("nl"),
      loadCatalog("nl"),
    ]);
    expect(first).toEqual(catalogs.nl);
    expect(second).toBe(first);
    await loadCatalog("nl");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(catalogUrl("nl"));
    expect(messagesFor("nl")).toBe(first);

    expect(messagesFor("en")).toBeUndefined();
    await loadCatalog("en");
    expect(messagesFor("en")).toEqual(catalogs.en);
    expect(messagesFor("nl")).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.getMessages).not.toHaveBeenCalled();
  });

  it("falls back to the server function when the catalog file cannot be fetched", async () => {
    stubFetch({ fail: true });
    const { loadCatalog, messagesFor } = await loadModule();
    await expect(loadCatalog("nl")).resolves.toEqual(serverCatalogs.nl);
    expect(mocks.getMessages).toHaveBeenCalledWith({ data: "nl" });
    expect(messagesFor("nl")).toEqual(serverCatalogs.nl);
  });

  it("retries on the next load when both the file and the server fail", async () => {
    stubFetch({ fail: true });
    mocks.getMessages.mockRejectedValueOnce(new Error("offline"));
    const { loadCatalog, messagesFor } = await loadModule();
    await expect(loadCatalog("nl")).rejects.toThrow("offline");
    expect(messagesFor("nl")).toBeUndefined();
    await expect(loadCatalog("nl")).resolves.toEqual(serverCatalogs.nl);
  });

  it("in dev, takes the server's catalog, which fills untranslated keys from source.json", async () => {
    vi.stubEnv("DEV", true);
    const fetchMock = stubFetch();
    const { loadCatalog, messagesFor } = await loadModule();
    await loadCatalog("nl");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(messagesFor("nl")).toEqual(serverCatalogs.nl);
  });
});

describe("loadCatalog on the server", () => {
  it("loads in-process through the server function on every request and never fetches", async () => {
    vi.stubGlobal("window", undefined);
    const fetchMock = stubFetch();
    const { loadCatalog, messagesFor } = await loadModule();
    await loadCatalog("nl");
    await loadCatalog("nl");
    expect(mocks.getMessages).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(messagesFor("nl")).toEqual(serverCatalogs.nl);
  });
});

describe("router (de)hydration", () => {
  it("dehydrates only the locale, never the catalog or anything else in the root context", async () => {
    const { dehydrateIntl } = await loadModule();
    const rootContext = {
      intl: { locale: "nl", timeZone: "Europe/Amsterdam", now: 0 },
      userId: "user_1",
      token: "jwt",
      messages: catalogs.nl,
    };
    expect(dehydrateIntl(rootContext)).toEqual({ locale: "nl" });
    expect(dehydrateIntl(undefined)).toEqual({ locale: undefined });
  });

  it("hydrates once the dehydrated locale's catalog has loaded", async () => {
    stubFetch();
    const { hydrateIntl, messagesFor } = await loadModule();
    await hydrateIntl({ locale: "nl" });
    expect(messagesFor("nl")).toEqual(catalogs.nl);
  });

  it("still hydrates when the catalog cannot load at all, and the next load retries", async () => {
    const fetchMock = stubFetch({ fail: true });
    mocks.getMessages.mockRejectedValueOnce(new Error("offline"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { hydrateIntl, loadCatalog, messagesFor } = await loadModule();

    await expect(hydrateIntl({ locale: "nl" })).resolves.toBeUndefined();
    expect(messagesFor("nl")).toBeUndefined();
    expect(errors).toHaveBeenCalledOnce();

    await expect(loadCatalog("nl")).resolves.toEqual(serverCatalogs.nl);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

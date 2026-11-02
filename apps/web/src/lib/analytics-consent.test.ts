import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAnalyticsConsent } from "./analytics-consent";

describe("readAnalyticsConsent", () => {
  it("is unset when there is no cookie string", () => {
    expect(readAnalyticsConsent(undefined)).toBe("unset");
    expect(readAnalyticsConsent(null)).toBe("unset");
    expect(readAnalyticsConsent("")).toBe("unset");
  });

  it("is unset when the consent cookie is absent", () => {
    expect(readAnalyticsConsent("jigswap-intl=nl; theme=dark")).toBe("unset");
  });

  it("reads an accepted notice as granted", () => {
    expect(readAnalyticsConsent("cookieConsent=true")).toBe("granted");
    expect(
      readAnalyticsConsent("jigswap-intl=nl; cookieConsent=true; theme=dark"),
    ).toBe("granted");
  });

  it("reads a declined notice as denied", () => {
    expect(readAnalyticsConsent("cookieConsent=false")).toBe("denied");
    expect(readAnalyticsConsent("a=1;  cookieConsent=false ")).toBe("denied");
  });

  it("does not match cookies whose name merely contains the consent name", () => {
    expect(readAnalyticsConsent("xcookieConsent=true")).toBe("unset");
  });

  it("treats malformed values as unset (analytics stays off)", () => {
    expect(readAnalyticsConsent("cookieConsent=")).toBe("unset");
    expect(readAnalyticsConsent("cookieConsent=yes")).toBe("unset");
  });
});

// --- Consent store and PostHog opt-in/opt-out ------------------------------

// A minimal cookie jar behind `document.cookie`: reads give "a=1; b=2", writes
// take one "name=value; attr; …" cookie at a time.
function cookieDocument(initial = "") {
  const jar = new Map<string, string>();
  const write = (raw: string) => {
    const [pair = ""] = raw.split(";");
    const [name = "", ...value] = pair.split("=");
    if (name.trim()) jar.set(name.trim(), value.join("="));
  };
  for (const part of initial.split(";")) write(part);
  return {
    get cookie() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    set cookie(raw: string) {
      write(raw);
    },
  };
}

// A browser that blocks cookies: reads stay empty and writes are thrown away.
function blockedCookieDocument() {
  return {
    get cookie() {
      return "";
    },
    set cookie(_raw: string) {
      // Discarded, like "block all cookies" does.
    },
  };
}

// Stand-in for a loaded PostHog client. Like the real one, reset() also
// clears the stored opt-out (posthog-js ConsentManager.reset), so the order
// in which the code calls reset() and opt_out_capturing() is observable.
function fakePostHog({ optedOut = false } = {}) {
  let out = optedOut;
  return {
    reset: vi.fn(() => {
      out = false;
    }),
    opt_out_capturing: vi.fn(() => {
      out = true;
    }),
    opt_in_capturing: vi.fn(() => {
      out = false;
    }),
    has_opted_out_capturing: () => out,
  };
}
type FakePostHog = ReturnType<typeof fakePostHog>;

let loaded: FakePostHog | null = null;
let finishLoading: ((client: FakePostHog | null) => void) | null = null;
const initPostHog = vi.fn(
  () =>
    new Promise<FakePostHog | null>((resolve) => {
      finishLoading = (client) => {
        loaded = client;
        resolve(client);
      };
    }),
);

// Stand-in for analytics-client's withdrawAnalyticsConsent, the one shutdown
// path. Its exact calls and its opt-in on a renewed grant are pinned in
// analytics-client.test.ts, together with the real pair of modules.
const stopPostHog = vi.fn(() => {
  loaded?.reset();
  loaded?.opt_out_capturing();
  return Promise.resolve();
});

// Fresh module state per test (the settings flag and listeners live in the
// module), with the PostHog loader replaced by a controllable fake.
async function freshConsent(
  cookie = "",
  doc: { cookie: string } = cookieDocument(cookie),
) {
  vi.resetModules();
  vi.doMock("./analytics-client", () => ({
    initPostHog,
    getPostHog: () => loaded,
    withdrawAnalyticsConsent: stopPostHog,
  }));
  vi.stubGlobal("document", doc);
  return import("./analytics-consent");
}

const freshConsentCookiesBlocked = () =>
  freshConsent("", blockedCookieDocument());

const consentCookie = () => readAnalyticsConsent(document.cookie);

beforeEach(() => {
  loaded = null;
  finishLoading = null;
  initPostHog.mockClear();
  stopPostHog.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("./analytics-client");
});

describe("consent store", () => {
  it("shows the banner to a visitor who has not chosen yet", async () => {
    const { getCookieBannerSnapshot } = await freshConsent();
    expect(getCookieBannerSnapshot()).toBe("undecided");
  });

  it("keeps the banner hidden once a choice is stored", async () => {
    const granted = await freshConsent("cookieConsent=true");
    expect(granted.getCookieBannerSnapshot()).toBe("hidden");
    const denied = await freshConsent("cookieConsent=false");
    expect(denied.getCookieBannerSnapshot()).toBe("hidden");
  });

  it("reopens the banner from Cookie settings and notifies subscribers", async () => {
    const { getCookieBannerSnapshot, openCookieSettings, subscribeConsent } =
      await freshConsent("cookieConsent=false");
    const listener = vi.fn();
    const unsubscribe = subscribeConsent(listener);

    openCookieSettings();

    expect(getCookieBannerSnapshot()).toBe("settings");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    openCookieSettings();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("closes the reopened banner when a new choice is made", async () => {
    const {
      getCookieBannerSnapshot,
      openCookieSettings,
      withdrawAnalyticsConsent,
    } = await freshConsent("cookieConsent=true");
    openCookieSettings();

    withdrawAnalyticsConsent();

    expect(getCookieBannerSnapshot()).toBe("hidden");
  });
});

describe("a browser that discards cookie writes", () => {
  it.each(["withdrawAnalyticsConsent", "grantAnalyticsConsent"] as const)(
    "hides the banner for this tab after %s",
    async (choose) => {
      const consent = await freshConsentCookiesBlocked();
      expect(consent.getCookieBannerSnapshot()).toBe("undecided");

      void consent[choose]();

      expect(consent.getCookieBannerSnapshot()).toBe("hidden");
    },
  );

  it("asks again on the next page load, when nothing was stored", async () => {
    const before = await freshConsentCookiesBlocked();
    before.withdrawAnalyticsConsent();

    const after = await freshConsentCookiesBlocked();

    expect(after.getCookieBannerSnapshot()).toBe("undecided");
  });

  it("can still reopen Cookie settings and change the choice", async () => {
    const consent = await freshConsentCookiesBlocked();
    consent.withdrawAnalyticsConsent();

    consent.openCookieSettings();
    expect(consent.getCookieBannerSnapshot()).toBe("settings");
    expect(consent.currentAnalyticsConsent()).toBe("denied");

    void consent.grantAnalyticsConsent();
    expect(consent.getCookieBannerSnapshot()).toBe("hidden");
    expect(consent.currentAnalyticsConsent()).toBe("granted");
  });

  it("honours Allow analytics for this tab instead of opting out", async () => {
    const { grantAnalyticsConsent } = await freshConsentCookiesBlocked();
    const granting = grantAnalyticsConsent();
    const client = fakePostHog();
    finishLoading?.(client);
    await granting;

    expect(client.reset).not.toHaveBeenCalled();
    expect(client.opt_out_capturing).not.toHaveBeenCalled();
  });

  it("stops a running PostHog on No thanks", async () => {
    const { withdrawAnalyticsConsent } = await freshConsentCookiesBlocked();
    const client = fakePostHog();
    loaded = client;

    withdrawAnalyticsConsent();

    expect(client.has_opted_out_capturing()).toBe(true);
  });
});

describe("currentAnalyticsConsent", () => {
  it("follows the cookie, so a choice made in another tab counts here", async () => {
    const { currentAnalyticsConsent, grantAnalyticsConsent } =
      await freshConsent();
    void grantAnalyticsConsent();
    expect(currentAnalyticsConsent()).toBe("granted");

    document.cookie = "cookieConsent=false";

    expect(currentAnalyticsConsent()).toBe("denied");
  });

  it("is unset before any choice", async () => {
    const { currentAnalyticsConsent } = await freshConsent();
    expect(currentAnalyticsConsent()).toBe("unset");
  });
});

describe("withdrawAnalyticsConsent", () => {
  it("stores the decline without loading analytics when it never started", async () => {
    const { withdrawAnalyticsConsent } = await freshConsent();

    withdrawAnalyticsConsent();

    expect(consentCookie()).toBe("denied");
    expect(initPostHog).not.toHaveBeenCalled();
  });

  it("stops a running PostHog and forgets its identity, leaving it opted out", async () => {
    const { withdrawAnalyticsConsent } =
      await freshConsent("cookieConsent=true");
    const client = fakePostHog();
    loaded = client;

    withdrawAnalyticsConsent();

    expect(consentCookie()).toBe("denied");
    expect(client.reset).toHaveBeenCalledTimes(1);
    expect(client.opt_out_capturing).toHaveBeenCalledTimes(1);
    // reset() clears PostHog's stored consent, so it must run first.
    expect(client.has_opted_out_capturing()).toBe(true);
  });

  it("wins over a grant whose PostHog download is still in flight", async () => {
    const { grantAnalyticsConsent, withdrawAnalyticsConsent } =
      await freshConsent();
    const granting = grantAnalyticsConsent();
    withdrawAnalyticsConsent();

    const client = fakePostHog();
    finishLoading?.(client);
    await granting;

    expect(consentCookie()).toBe("denied");
    expect(client.opt_in_capturing).not.toHaveBeenCalled();
    expect(client.has_opted_out_capturing()).toBe(true);
  });
});

describe("grantAnalyticsConsent", () => {
  it("stores the grant and starts PostHog", async () => {
    const { grantAnalyticsConsent, getCookieBannerSnapshot } =
      await freshConsent();
    const granting = grantAnalyticsConsent();

    expect(consentCookie()).toBe("granted");
    expect(getCookieBannerSnapshot()).toBe("hidden");
    expect(initPostHog).toHaveBeenCalledTimes(1);

    const client = fakePostHog();
    finishLoading?.(client);
    await granting;
    // Never opted out: no opt-in call (it would send an extra $opt_in event).
    expect(client.opt_in_capturing).not.toHaveBeenCalled();
    expect(client.reset).not.toHaveBeenCalled();
  });

  it("starts PostHog again after an earlier withdrawal, without stopping it", async () => {
    const { grantAnalyticsConsent } = await freshConsent("cookieConsent=false");
    const granting = grantAnalyticsConsent();
    finishLoading?.(fakePostHog());
    await granting;

    expect(consentCookie()).toBe("granted");
    expect(initPostHog).toHaveBeenCalledTimes(1);
    expect(stopPostHog).not.toHaveBeenCalled();
  });

  it("copes with PostHog not loading (no key, or blocked)", async () => {
    const { grantAnalyticsConsent } = await freshConsent();
    const granting = grantAnalyticsConsent();
    finishLoading?.(null);

    await expect(granting).resolves.toBeUndefined();
    expect(consentCookie()).toBe("granted");
  });
});

describe("startAnalyticsIfGranted", () => {
  it("does not load PostHog for an undecided or declined visitor", async () => {
    const undecided = await freshConsent();
    undecided.startAnalyticsIfGranted();
    const declined = await freshConsent("cookieConsent=false");
    declined.startAnalyticsIfGranted();

    expect(initPostHog).not.toHaveBeenCalled();
  });

  it("loads PostHog for a visitor who allowed it, honouring a withdrawal made while it loads", async () => {
    const { startAnalyticsIfGranted, withdrawAnalyticsConsent } =
      await freshConsent("cookieConsent=true");
    startAnalyticsIfGranted();
    expect(initPostHog).toHaveBeenCalledTimes(1);

    withdrawAnalyticsConsent();
    const client = fakePostHog();
    finishLoading?.(client);
    await vi.waitFor(() =>
      expect(client.opt_out_capturing).toHaveBeenCalledTimes(1),
    );
    expect(client.has_opted_out_capturing()).toBe(true);
  });
});

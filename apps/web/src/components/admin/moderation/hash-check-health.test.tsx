// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import type { CsamEscalations } from "./csam-escalations";
import { HashCheckHealth } from "./hash-check-health";

vi.mock("@/gateway", () => ({ gateway: {} }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.UTC(2026, 9, 18, 12);

type HashCheck = CsamEscalations["hashCheck"];

const hashCheck = (overrides: Partial<HashCheck> = {}): HashCheck => ({
  provider: "offlimits",
  status: "ok",
  missingVars: [],
  waitingPhotos: 0,
  oldestWaitingSince: null,
  waitingCapped: false,
  timedOutPhotos: 0,
  uncheckedPhotos: 0,
  uncheckedSince: null,
  uncheckedCapped: false,
  ...overrides,
});

const disabled = (overrides: Partial<HashCheck> = {}) =>
  hashCheck({ provider: "none", status: "disabled", ...overrides });

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (value: HashCheck | undefined, locale: "en" | "nl" = "en") =>
  act(() =>
    root.render(
      <IntlProvider
        locale={locale}
        timeZone="UTC"
        now={new Date(NOW)}
        messages={locale === "en" ? en : nl}
      >
        <HashCheckHealth hashCheck={value} />
      </IntlProvider>,
    ),
  );

const text = () => container.textContent ?? "";

describe("HashCheckHealth", () => {
  it("renders nothing while loading, or when matching works and nothing waits", () => {
    render(undefined);
    expect(container.innerHTML).toBe("");
    render(hashCheck());
    expect(container.innerHTML).toBe("");
    // Timed-out photos are an admin queue (Unchecked photos), told on the Hash matches tab.
    render(hashCheck({ timedOutPhotos: 2 }));
    expect(container.innerHTML).toBe("");
  });

  it("says hash matching is OFF when no provider is selected, as a red status", () => {
    render(disabled());
    const banner = container.querySelector('[role="status"]');
    expect(banner?.className).toContain("border-destructive");
    expect(text()).toContain("CSAM hash matching is OFF on this deployment");
    expect(text()).toContain(
      "Uploads are not compared with lists of known child sexual abuse material",
    );
    expect(text()).toContain("photos are published without that check");
    // Nothing counted yet: no count line.
    expect(text()).not.toContain("published without a hash check since");

    render(disabled(), "nl");
    expect(text()).toContain("CSAM-hash-matching staat UIT op deze omgeving");
  });

  it("counts the photos published without a hash check, from the oldest, and says older ones are not counted", () => {
    render(
      disabled({
        uncheckedPhotos: 12,
        uncheckedSince: Date.UTC(2026, 9, 1, 9),
      }),
    );
    expect(text()).toContain(
      "12 photos were published without a hash check since Oct 1, 2026.",
    );
    expect(text()).toContain(
      "Photos published before this count started are not included",
    );
    // Matching is off: there is nothing to re-check with yet.
    expect(text()).not.toContain("recheckWaivedHashes");

    render(
      disabled({ uncheckedPhotos: 1, uncheckedSince: Date.UTC(2026, 9, 1) }),
      "nl",
    );
    expect(text()).toContain(
      "1 foto is sinds 1 okt 2026 zonder hash-check gepubliceerd.",
    );
  });

  it("marks a count that hit the per-table cap with a plus", () => {
    render(
      disabled({
        uncheckedPhotos: 400,
        uncheckedSince: Date.UTC(2026, 9, 1),
        uncheckedCapped: true,
      }),
    );
    expect(text()).toContain("400+ photos were published");
  });

  it("names the missing settings when Offlimits is selected but not configured", () => {
    render(
      hashCheck({
        status: "missing_config",
        missingVars: ["OFFLIMITS_HCS_USERNAME", "OFFLIMITS_HCS_PASSWORD"],
      }),
    );
    expect(text()).toContain("CSAM hash matching is OFF");
    expect(text()).toContain(
      "not set: OFFLIMITS_HCS_USERNAME, OFFLIMITS_HCS_PASSWORD",
    );
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("says matching is unreachable while photos wait on it", () => {
    render(
      hashCheck({
        waitingPhotos: 3,
        oldestWaitingSince: NOW - 2 * 3_600_000,
      }),
    );
    expect(text()).toContain("CSAM hash matching is unreachable");
    expect(text()).toContain(
      "3 photos are held unpublished until it answers (oldest 2 hours ago)",
    );
    // An unreachable service cannot re-check anything yet.
    expect(text()).not.toContain("recheckWaivedHashes");

    // "N+" only when a table's count hit its cap, never for an exact total of 200 or more.
    render(
      hashCheck({
        waitingPhotos: 250,
        waitingCapped: false,
        oldestWaitingSince: NOW - 3_600_000,
      }),
    );
    expect(text()).toContain("250 photos are held unpublished");
    expect(text()).not.toContain("250+");
    render(
      hashCheck({
        waitingPhotos: 200,
        waitingCapped: true,
        oldestWaitingSince: NOW - 3_600_000,
      }),
    );
    expect(text()).toContain("200+ photos are held unpublished");
  });

  it("once matching works, points to the re-check for the photos published without one", () => {
    render(
      hashCheck({ uncheckedPhotos: 5, uncheckedSince: Date.UTC(2026, 8, 30) }),
    );
    expect(text()).toContain("Photos published without a CSAM hash check");
    expect(text()).toContain(
      "5 photos were published without a hash check since Sep 30, 2026.",
    );
    expect(text()).toContain("recheckWaivedHashes");
    expect(text()).not.toContain("is OFF");
  });
});

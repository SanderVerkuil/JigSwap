// @vitest-environment happy-dom
import { useStartedLabel } from "@/components/solving/use-started-label";
import { act, cleanup } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../locales/en.json";
import { useMemberToday } from "./use-member-today";

// "Today" on a server-rendered page. The server runs in UTC and the browser where the member is, so
// the runtime's own calendar is a different day for them for hours around midnight. The server and
// the first client render have to agree all the same; the member's own calendar takes over after.

// 00:30 on 3 November in Amsterdam, the app's time zone; still the 2nd in UTC and New York.
const INSTANT = new Date("2026-11-02T23:30:00Z");
const NOV_2 = Date.UTC(2026, 10, 2);
const NOV_3 = Date.UTC(2026, 10, 3);

const Today = () => <span>{useMemberToday()}</span>;
const Started = ({ on }: { on: number }) => (
  <span>{useStartedLabel()(on)}</span>
);

const app = (children: React.ReactNode) => (
  <IntlProvider
    locale="en"
    messages={en}
    timeZone="Europe/Amsterdam"
    now={INSTANT}
  >
    {children}
  </IntlProvider>
);

/** Renders on a server in `serverZone`, then hydrates in a browser in `browserZone`. */
const serveAndHydrate = async (
  ui: React.ReactNode,
  serverZone: string,
  browserZone: string,
) => {
  vi.stubEnv("TZ", serverZone);
  const html = renderToString(app(ui));
  vi.stubEnv("TZ", browserZone);
  const container = document.createElement("div");
  container.innerHTML = html;
  const painted = container.textContent;
  const onRecoverableError = vi.fn();
  await act(async () => {
    hydrateRoot(container, app(ui), { onRecoverableError });
  });
  return { painted, settled: container.textContent, onRecoverableError };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(INSTANT);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("useMemberToday", () => {
  it.each(["UTC", "America/New_York", "Asia/Tokyo"])(
    "paints the app's day on a server in %s",
    (zone) => {
      vi.stubEnv("TZ", zone);
      expect(renderToString(app(<Today />))).toContain(String(NOV_3));
    },
  );

  it("hydrates without a mismatch when server and browser are a day apart", async () => {
    const { painted, settled, onRecoverableError } = await serveAndHydrate(
      <Today />,
      "UTC",
      "Europe/Amsterdam",
    );
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(painted).toBe(String(NOV_3));
    expect(settled).toBe(String(NOV_3));
  });

  it("moves to the member's own calendar once hydrated", async () => {
    const { painted, settled, onRecoverableError } = await serveAndHydrate(
      <Today />,
      "UTC",
      "America/New_York",
    );
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(painted).toBe(String(NOV_3));
    expect(settled).toBe(String(NOV_2));
  });
});

describe("useStartedLabel on a server-rendered page", () => {
  it("doesn't tell the server's day apart from the browser's", async () => {
    const { painted, settled, onRecoverableError } = await serveAndHydrate(
      <Started on={NOV_3} />,
      "UTC",
      "Europe/Amsterdam",
    );
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(painted).toBe("Started today");
    expect(settled).toBe("Started today");
  });
});

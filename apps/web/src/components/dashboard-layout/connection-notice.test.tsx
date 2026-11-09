// @vitest-environment happy-dom
// Offline, the shell says so (F74): a slim status strip once the connection has been gone for a
// few seconds. Driven by the browser's online/offline signal and Convex's socket, through a fake
// client here.
import { act, cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  CONNECTION_NOTICE_DELAY_MS,
  ConnectionNotice,
} from "./connection-notice";

const socket = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { isWebSocketConnected: true, hasEverConnected: true };
  return {
    state,
    set(next: Partial<typeof state>) {
      Object.assign(state, next);
      for (const listener of listeners) listener();
    },
    client: {
      connectionState: () => ({ ...state }),
      subscribeToConnectionState: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
});

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useConvex: () => socket.client,
}));

const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
};

const renderNotice = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <ConnectionNotice />
    </IntlProvider>,
  );

const notice = () => screen.getByRole("status");

beforeEach(() => {
  vi.useFakeTimers();
  socket.state.isWebSocketConnected = true;
  socket.state.hasEverConnected = true;
  setOnline(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "onLine");
});

describe("ConnectionNotice", () => {
  it("keeps an empty status region while connected", () => {
    renderNotice();
    act(() => {
      vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS * 2);
    });
    expect(notice().textContent).toBe("");
  });

  it("says the app is offline once the browser has been offline for a few seconds", () => {
    renderNotice();
    act(() => setOnline(false));
    act(() => {
      vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS - 1);
    });
    expect(notice().textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(notice().textContent).toBe(en.shell.connection.offline);
  });

  it("also shows when the socket drops while the browser still claims to be online", () => {
    renderNotice("nl");
    act(() => socket.set({ isWebSocketConnected: false }));
    act(() => {
      vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);
    });
    expect(notice().textContent).toBe(nl.shell.connection.offline);
  });

  it("stays quiet through a short drop, and goes as soon as the connection is back", () => {
    renderNotice();
    act(() => socket.set({ isWebSocketConnected: false }));
    act(() => {
      vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS / 2);
    });
    act(() => socket.set({ isWebSocketConnected: true }));
    act(() => {
      vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);
    });
    expect(notice().textContent).toBe("");

    act(() => socket.set({ isWebSocketConnected: false }));
    act(() => {
      vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS);
    });
    expect(notice().textContent).not.toBe("");
    act(() => socket.set({ isWebSocketConnected: true }));
    expect(notice().textContent).toBe("");

    // A new drop waits again before it says anything.
    act(() => socket.set({ isWebSocketConnected: false }));
    expect(notice().textContent).toBe("");
  });

  it("says nothing while the socket is still making its first connection", () => {
    socket.state.isWebSocketConnected = false;
    socket.state.hasEverConnected = false;
    renderNotice();
    act(() => {
      vi.advanceTimersByTime(CONNECTION_NOTICE_DELAY_MS * 3);
    });
    expect(notice().textContent).toBe("");
  });
});

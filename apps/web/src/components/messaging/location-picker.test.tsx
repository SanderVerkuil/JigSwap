// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { pixelToLatLng, project } from "./location-math";
import { LocationPickerBody } from "./location-picker";

const SEARCH = getFunctionName(gateway.conversation.searchPlaces);
const RENDER = getFunctionName(gateway.conversation.renderPickerMap);
const SEND = getFunctionName(gateway.conversation.sendLocation);

const mocks = vi.hoisted(() => ({
  call: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  // The next sendLocation refuses with this code.
  sendRefusal: null as string | null,
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexAction:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.call(getFunctionName(ref), args),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.call(getFunctionName(ref), args),
}));

type Args = Record<string, unknown>;
const callsTo = (name: string) =>
  mocks.call.mock.calls
    .filter(([called]) => called === name)
    .map(([, args]) => args as Args);

const callbacks = {
  onSent: vi.fn(),
  onCannotReply: vi.fn(),
  onUnavailable: vi.fn(),
};

const renderPicker = ({ exactCurrentLocation = false } = {}) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <LocationPickerBody
          threadId="thread_1"
          recipientName="Mara"
          exactCurrentLocation={exactCurrentLocation}
          {...callbacks}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );

const sendButton = () =>
  screen.getByRole("button", { name: "Send location" }) as HTMLButtonElement;

const searchFor = async (text: string) => {
  fireEvent.change(screen.getByLabelText("Search for a place"), {
    target: { value: text },
  });
  return screen.findByRole("button", { name: /Domplein/ });
};

const fakeGeolocation = (coords?: { latitude: number; longitude: number }) => {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (
        ok: (position: { coords: typeof coords }) => void,
        fail: () => void,
      ) => (coords ? ok({ coords }) : fail()),
    },
  });
};

beforeEach(() => {
  mocks.call.mockReset().mockImplementation(async (name, args) => {
    const a = args as Args;
    if (name === SEARCH) {
      return [
        { label: "Domplein, Utrecht, Nederland", lat: 52.0907, lng: 5.1214 },
      ];
    }
    if (name === RENDER) {
      return {
        url: `https://convex.test/map-${a.lat}-${a.lng}-${a.zoom}.png`,
        lat: a.lat,
        lng: a.lng,
        zoom: Math.min(18, Math.max(3, Math.round(a.zoom as number))),
        width: 600,
        height: 360,
      };
    }
    if (name === SEND) {
      const code = mocks.sendRefusal;
      mocks.sendRefusal = null;
      if (code) throw new ConvexError({ code });
      return { attachmentId: "att_1" };
    }
    return null;
  });
  Object.values(callbacks).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

describe("LocationPickerBody", () => {
  it("starts search-first: no map, nothing to send", () => {
    renderPicker();
    expect(
      screen.getByText(
        "Search for a place or use your current location to place the pin.",
      ),
    ).toBeTruthy();
    expect(sendButton().disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("a search result centres the map on it and sends an exact pin with its name", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPicker();
      const result = await searchFor("Domplein");
      expect(callsTo(SEARCH)[0]).toEqual({
        threadId: "thread_1",
        query: "Domplein",
      });
      fireEvent.click(result);
      const map = await waitFor(() => {
        const img = document.querySelector("img");
        if (!img) throw new Error("no map yet");
        return img;
      });
      expect(map.getAttribute("src")).toBe(
        "https://convex.test/map-52.0907-5.1214-16.png",
      );
      expect(
        (
          screen.getByLabelText(
            "Name of the place (optional)",
          ) as HTMLInputElement
        ).value,
      ).toBe("Domplein");
      // A placed pin: no precision choice.
      expect(screen.queryByText("Share my exact location")).toBeNull();
      fireEvent.change(screen.getByLabelText("Message (optional)"), {
        target: { value: "  At the fountain " },
      });
      await act(async () => fireEvent.click(sendButton()));
      expect(callsTo(SEND)[0]).toEqual({
        threadId: "thread_1",
        lat: 52.0907,
        lng: 5.1214,
        source: "pin",
        precision: "exact",
        label: "Domplein",
        caption: "At the fountain",
      });
      expect(callbacks.onSent).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("current location to a non-mutual: centred, approximate, no exact toggle", async () => {
    fakeGeolocation({ latitude: 52.123456, longitude: 5.098765 });
    renderPicker({ exactCurrentLocation: false });
    fireEvent.click(
      screen.getByRole("button", { name: "Use my current location" }),
    );
    await screen.findByText(
      "Your current location is shared as an approximate area (about 1 km).",
    );
    expect(screen.queryByText("Share my exact location")).toBeNull();
    expect(callsTo(RENDER)[0]).toMatchObject({ lat: 52.12346, lng: 5.09877 });
    await act(async () => fireEvent.click(sendButton()));
    expect(callsTo(SEND)[0]).toMatchObject({
      source: "gps",
      precision: "approximate",
    });
  });

  it("current location to a mutual follower: exact only once toggled, with a warning", async () => {
    fakeGeolocation({ latitude: 52.123456, longitude: 5.098765 });
    renderPicker({ exactCurrentLocation: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Use my current location" }),
    );
    const toggle = await screen.findByRole("switch", {
      name: "Share my exact location",
    });
    fireEvent.click(toggle);
    expect(
      screen.getByText("Mara will see exactly where you are now."),
    ).toBeTruthy();
    await act(async () => fireEvent.click(sendButton()));
    expect(callsTo(SEND)[0]).toMatchObject({
      source: "gps",
      precision: "exact",
    });
  });

  it("a denied location permission says so and keeps search available", async () => {
    fakeGeolocation(undefined);
    renderPicker();
    fireEvent.click(
      screen.getByRole("button", { name: "Use my current location" }),
    );
    expect(
      await screen.findByText(
        "Your location isn't available. Search for a place instead.",
      ),
    ).toBeTruthy();
    expect(sendButton().disabled).toBe(true);
  });

  it("buttons zoom and pan (re-rendered by the server); moving a GPS pin makes it a placed pin", async () => {
    fakeGeolocation({ latitude: 52, longitude: 5 });
    renderPicker({ exactCurrentLocation: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Use my current location" }),
    );
    await waitFor(() => expect(document.querySelector("img")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(callsTo(RENDER)).toHaveLength(2));
    expect(callsTo(RENDER)[1]).toMatchObject({ lat: 52, lng: 5, zoom: 16 });
    // Zooming keeps the pin where it is: still the device position.
    expect(screen.getByRole("switch")).toBeTruthy();

    await waitFor(() =>
      expect(document.querySelector("img")!.getAttribute("src")).toContain(
        "-16.png",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Move east" }));
    await waitFor(() => expect(callsTo(RENDER)).toHaveLength(3));
    const east = callsTo(RENDER)[2] as { lat: number; lng: number };
    expect(east.lat).toBeCloseTo(52, 4);
    expect(east.lng).toBeGreaterThan(5);
    // A quarter of 600 px at zoom 16.
    const expected = pixelToLatLng(
      { lat: 52, lng: 5, zoom: 16, width: 600, height: 360 },
      450,
      180,
    );
    expect(east.lng).toBeCloseTo(expected.lng, 5);
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("a tap on the map moves the pin to the tapped coordinates", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPicker();
      fireEvent.click(await searchFor("Domplein"));
      await waitFor(() => expect(document.querySelector("img")).toBeTruthy());
      const surface = document.querySelector("img")!.parentElement!;
      // Displayed at half size: 300 x 180.
      surface.getBoundingClientRect = () =>
        ({ left: 10, top: 20, width: 300, height: 180 }) as DOMRect;
      fireEvent.click(surface, {
        clientX: 10 + 225,
        clientY: 20 + 45,
        detail: 1,
      });
      await waitFor(() => expect(callsTo(RENDER)).toHaveLength(2));
      const moved = callsTo(RENDER)[1] as { lat: number; lng: number };
      // (225, 45) on a 300x180 image = (450, 90) on the 600x360 view:
      // a quarter view east and north of the centre.
      const centre = project(52.0907, 5.1214, 16);
      const tapped = project(moved.lat, moved.lng, 16);
      expect(tapped.x - centre.x).toBeCloseTo(150, 0);
      expect(tapped.y - centre.y).toBeCloseTo(-90, 0);
      // A keyboard "click" (no position) does nothing.
      fireEvent.click(surface, { detail: 0 });
      expect(callsTo(RENDER)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps send refusals: rate limit text, can't reply, unavailable", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPicker();
      fireEvent.click(await searchFor("Domplein"));
      await waitFor(() => expect(sendButton().disabled).toBe(false));
      await waitFor(() => expect(document.querySelector("img")).toBeTruthy());
      const refuse = (code: string) => {
        mocks.sendRefusal = code;
      };

      refuse("RateLimited");
      await act(async () => fireEvent.click(sendButton()));
      expect((await screen.findByRole("alert")).textContent).toBe(
        "You've shared the most locations allowed for now. Try again later.",
      );

      refuse("CannotReply");
      await act(async () =>
        fireEvent.click(
          await screen.findByRole("button", { name: "Send location" }),
        ),
      );
      expect(callbacks.onCannotReply).toHaveBeenCalled();

      refuse("LocationUnavailable");
      const button = await screen.findByRole("button", {
        name: "Send location",
      });
      await act(async () => fireEvent.click(button));
      expect(callbacks.onUnavailable).toHaveBeenCalled();
      expect(callbacks.onSent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed search says so", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mocks.call.mockImplementation(async () => {
        throw new ConvexError({ code: "SearchUnavailable" });
      });
      renderPicker();
      fireEvent.change(screen.getByLabelText("Search for a place"), {
        target: { value: "Domplein" },
      });
      expect(
        await screen.findByText("Place search isn't available right now."),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

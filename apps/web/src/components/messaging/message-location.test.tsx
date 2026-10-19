// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { MessageComposer } from "./message-composer";
import { MessageLocation, type LocationView } from "./message-location";

vi.mock("@convex-dev/react-query", async (importOriginal) => {
  const fn = Object.assign(async () => null, {
    withOptimisticUpdate: () => fn,
  });
  return {
    ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
    useConvexMutation: () => fn,
    useConvexAction: () => fn,
  };
});

vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "me" }, isMemberLoading: false }),
}));

afterEach(cleanup);

const withIntl = (node: ReactNode, client = new QueryClient()) => (
  <QueryClientProvider client={client}>
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      {node}
    </IntlProvider>
  </QueryClientProvider>
);

const location = (overrides: Partial<LocationView> = {}): LocationView => ({
  kind: "location",
  lat: 52.09074,
  lng: 5.12142,
  precision: "exact",
  label: "Domplein",
  mapUrl: "https://convex.test/map.png",
  openUrl:
    "https://www.openstreetmap.org/?mlat=52.09074&mlon=5.12142#map=17/52.09074/5.12142",
  ...overrides,
});

describe("MessageLocation bubble", () => {
  it("ready: the stored map, the label in bold and an Open in maps link in a new tab", () => {
    render(withIntl(<MessageLocation location={location()} />));
    const img = screen.getByRole("img", { name: "Map of Domplein" });
    expect(img.getAttribute("src")).toBe("https://convex.test/map.png");
    expect(screen.getByText("Domplein").className).toContain("font-semibold");
    expect(screen.queryByText("Approximate area")).toBeNull();
    const link = screen.getByRole("link", { name: /Open in maps/ });
    expect(link.getAttribute("href")).toBe(location().openUrl);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("approximate: says so; no label falls back to 'Shared location'", () => {
    render(
      withIntl(
        <MessageLocation
          location={location({ precision: "approximate", label: undefined })}
        />,
      ),
    );
    expect(screen.getByText("Approximate area")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Map of Shared location" }),
    ).toBeTruthy();
  });

  it("failed render: a text card with the coordinates and the link, no image", () => {
    render(
      withIntl(<MessageLocation location={location({ mapUrl: undefined })} />),
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/Map preview unavailable/)).toBeTruthy();
    expect(screen.getByText("52.09074, 5.12142")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open in maps/ })).toBeTruthy();
  });

  it("gone: a placeholder", () => {
    render(withIntl(<MessageLocation location={undefined} />));
    expect(
      screen.getByText("This location is no longer available."),
    ).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("Location in the composer's attach menu", () => {
  const renderComposer = (available: boolean | undefined) => {
    const client = new QueryClient();
    if (available !== undefined) {
      client.setQueryData(
        convexQuery(gateway.conversation.locationAvailable, {
          threadId: "thread_1",
        }).queryKey,
        { available, exactCurrentLocation: false },
      );
    }
    render(
      withIntl(
        <MessageComposer
          threadId="thread_1"
          recipientName="Mara"
          theirsLabel={null}
        />,
        client,
      ),
    );
  };
  const menuItems = async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "Attach" }), {
      key: "Enter",
    });
    await screen.findAllByRole("menuitem");
    return screen.getAllByRole("menuitem").map((item) => item.textContent);
  };

  it("is hidden when location sharing is unavailable (no key)", async () => {
    renderComposer(false);
    expect(await menuItems()).not.toContain("Location");
  });

  it("is hidden while the probe has not answered", async () => {
    renderComposer(undefined);
    expect(await menuItems()).not.toContain("Location");
  });

  it("is offered when available, and opens the picker", async () => {
    renderComposer(true);
    expect(await menuItems()).toContain("Location");
    fireEvent.click(screen.getByRole("menuitem", { name: "Location" }));
    expect(
      await screen.findByRole("dialog", { name: "Share a location" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Share this spot with Mara? They'll see it on a map in this conversation. Pick a public meet-up place rather than your home address.",
      ),
    ).toBeTruthy();
  });
});

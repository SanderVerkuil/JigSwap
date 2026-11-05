// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import type { PushDeviceView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { OtherPushDevices } from "./other-push-devices";

const mocks = vi.hoisted(() => ({
  devices: undefined as PushDeviceView[] | undefined,
  queryKeys: [] as unknown[],
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));
// Device reads come from mocks.devices; a skipped query has no data.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: unknown; enabled?: boolean }) => {
    mocks.queryKeys.push(options.queryKey);
    return { data: options.enabled === false ? undefined : mocks.devices };
  },
}));

const LIST = getFunctionName(gateway.notifications.pushDevices);
const REVOKE = getFunctionName(gateway.notifications.revokePushDevice);
const OCT_3 = Date.UTC(2026, 9, 3, 12);
const OCT_20 = Date.UTC(2026, 9, 20, 12);

const renderList = ({
  currentEndpoint = "https://fcm.googleapis.com/fcm/send/this-browser",
  ready = true,
  locale = "en",
}: {
  currentEndpoint?: string | null;
  ready?: boolean;
  locale?: "en" | "nl";
} = {}) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <OtherPushDevices currentEndpoint={currentEndpoint} ready={ready} />
      </IntlProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  mocks.devices = [
    { id: "dev_ff", service: "firefox", createdAt: OCT_20, current: false },
    { id: "dev_me", service: "chrome", createdAt: OCT_3, current: true },
    { id: "dev_ios", service: "safari", createdAt: OCT_3, current: false },
  ];
  mocks.queryKeys.length = 0;
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("OtherPushDevices (SEC-54)", () => {
  it("lists the member's other push devices, not this one, asking with this browser's endpoint", () => {
    renderList();
    expect(mocks.queryKeys.at(-1)).toEqual([
      "convexQuery",
      LIST,
      { currentEndpoint: "https://fcm.googleapis.com/fcm/send/this-browser" },
    ]);
    expect(
      screen.getByRole("heading", { name: "Other devices with push" }),
    ).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "FirefoxAdded Oct 20, 2026Remove",
      "Safari (Mac, iPhone or iPad)Added Oct 3, 2026Remove",
    ]);
  });

  it("names each Remove button after its device", () => {
    renderList();
    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Remove Firefox, added Oct 20, 2026",
      "Remove Safari (Mac, iPhone or iPad), added Oct 3, 2026",
    ]);
  });

  it("asks without an endpoint when this browser has no subscription", () => {
    renderList({ currentEndpoint: null });
    expect(mocks.queryKeys.at(-1)).toEqual(["convexQuery", LIST, {}]);
  });

  it("waits until this browser's own subscription is known", () => {
    renderList({ ready: false });
    expect(mocks.queryKeys.at(-1)).toEqual(["convexQuery", LIST, "skip"]);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders nothing when this is the only device", () => {
    mocks.devices = [
      { id: "dev_me", service: "chrome", createdAt: OCT_3, current: true },
    ];
    const { container } = renderList();
    expect(container.textContent).toBe("");
  });

  it("revokes the chosen device and confirms", async () => {
    renderList();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Firefox, added Oct 20, 2026",
      }),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "That device no longer gets push notifications",
      ),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(REVOKE, { id: "dev_ff" });
  });

  it("says so when the revoke fails", async () => {
    mocks.mutation.mockRejectedValue(new Error("offline"));
    renderList();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Firefox, added Oct 20, 2026",
      }),
    );
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't remove that device",
      ),
    );
  });

  it("speaks Dutch", () => {
    renderList({ locale: "nl" });
    expect(
      screen.getByRole("heading", { name: "Andere apparaten met push" }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual([
      "FirefoxToegevoegd op 20 okt 2026Verwijderen",
      "Safari (Mac, iPhone of iPad)Toegevoegd op 3 okt 2026Verwijderen",
    ]);
    expect(screen.getAllByRole("button")[0].getAttribute("aria-label")).toBe(
      "Firefox verwijderen, toegevoegd op 20 okt 2026",
    );
  });
});

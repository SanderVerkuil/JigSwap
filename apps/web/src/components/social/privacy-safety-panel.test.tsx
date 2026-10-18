// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { PrivacySafetyPanel } from "./privacy-safety-panel";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
}));

vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { id: "user_me" } }),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const UNBLOCK = getFunctionName(gateway.social.unblockMember);
const NOW = new Date("2026-10-18T12:00:00Z");

const renderPanel = (blocks: unknown[], locale: "en" | "nl" = "en") => {
  const convexQueryClient = new ConvexQueryClient(
    new ConvexReactClient("https://example.convex.cloud"),
  );
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        staleTime: Infinity,
        retry: false,
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  queryClient.setQueryData(
    convexQuery(gateway.social.listMyBlocks, {}).queryKey,
    blocks,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
        now={NOW}
      >
        <PrivacySafetyPanel />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

describe("PrivacySafetyPanel", () => {
  it("shows the empty state when nobody is blocked", () => {
    renderPanel([]);
    expect(
      screen.getByRole("heading", { name: "Privacy & safety" }),
    ).toBeTruthy();
    expect(screen.getByText("You haven't blocked anyone.")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("lists blocked members with their block date", () => {
    renderPanel([
      {
        memberId: "member_mara",
        name: "Mara",
        handle: "mara",
        blockedAt: NOW.getTime() - 3 * 24 * 60 * 60 * 1000,
      },
    ]);
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Mara")).toBeTruthy();
    expect(row.textContent).toContain("Blocked 3 days ago");
    expect(row.querySelector("time")?.getAttribute("dateTime")).toBe(
      "2026-10-15T12:00:00.000Z",
    );
  });

  it("unblocks a member after the confirm", async () => {
    renderPanel([
      {
        memberId: "member_mara",
        name: "Mara",
        handle: "mara",
        blockedAt: NOW.getTime(),
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Unblock Mara" }));
    const dialog = screen.getByRole("alertdialog", { name: "Unblock Mara?" });
    expect(mocks.mutation).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Unblock" }));
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(UNBLOCK, {
        memberId: "member_mara",
      }),
    );
  });

  it("renders in Dutch", () => {
    renderPanel([], "nl");
    expect(
      screen.getByRole("heading", { name: "Privacy en veiligheid" }),
    ).toBeTruthy();
    expect(screen.getByText("Je hebt niemand geblokkeerd.")).toBeTruthy();
  });
});

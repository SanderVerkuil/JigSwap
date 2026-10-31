// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  ShareWithCirclesDialog,
  type ShareWithCirclesCopy,
} from "./share-with-circles-dialog";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toast: { success: vi.fn(), error: vi.fn() },
  onOpenChange: vi.fn(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const fn = (args: unknown) => mocks.mutation(getFunctionName(ref), args);
    return Object.assign(fn, { withOptimisticUpdate: () => fn });
  },
}));

vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));

type Rows = NonNullable<
  FunctionReturnType<typeof gateway.sharing.copyCircleShares>
>;

const SHARE = getFunctionName(gateway.sharing.shareCopiesToCircle);
const UNSHARE = getFunctionName(gateway.sharing.unshareCopyFromCircle);
const OFFERED = { forTrade: true, forSale: false, forLend: false };
const CLOSED = { forTrade: false, forSale: false, forLend: false };

const row = (
  circleId: string,
  name: string,
  fields: Partial<Rows[number]> = {},
): Rows[number] => ({
  circleId,
  name,
  memberCount: 4,
  viewerPermission: "Exchange",
  shared: false,
  canShare: true,
  ...fields,
});

const ROWS: Rows = [
  row("c_family", "Family", { shared: true }),
  row("c_club", "Puzzle Club"),
  row("c_view", "Neighbours", {
    viewerPermission: "ViewOnly",
    canShare: false,
  }),
  row("c_was", "Old friends", {
    viewerPermission: "ViewOnly",
    canShare: false,
    shared: true,
  }),
];

const COPY: ShareWithCirclesCopy = {
  copyId: "copy_1",
  title: "Lighthouse",
  availability: OFFERED,
  visibility: "visible",
};

const renderDialog = ({
  rows = ROWS,
  copy = COPY,
  locale = "en",
}: {
  rows?: Rows | null;
  copy?: ShareWithCirclesCopy;
  locale?: "en" | "nl";
} = {}) => {
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
    convexQuery(gateway.sharing.copyCircleShares, { copyId: copy.copyId })
      .queryKey,
    rows,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <ShareWithCirclesDialog
          open
          onOpenChange={mocks.onOpenChange}
          copy={copy}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const box = (name: string) => screen.getByRole("checkbox", { name });

beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.toast.success.mockReset();
  mocks.toast.error.mockReset();
  mocks.onOpenChange.mockReset();
});
afterEach(cleanup);

describe("ShareWithCirclesDialog", () => {
  it("ticks the circles the copy is shared in and locks a View only seat", () => {
    renderDialog();

    expect(
      screen.getByRole("heading", { name: "Share “Lighthouse” with circles" }),
    ).toBeTruthy();
    expect(box("Family").getAttribute("aria-checked")).toBe("true");
    expect(box("Puzzle Club").getAttribute("aria-checked")).toBe("false");
    // A View only seat can't add a share…
    expect(box("Neighbours").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(en.circles.shareDialog.viewOnly)).toBeTruthy();
    // …but can take back the one it already has.
    expect(box("Old friends").hasAttribute("disabled")).toBe(false);
    expect(
      screen.getByRole("button", { name: en.circles.shareDialog.save }),
    ).toHaveProperty("disabled", true);
    expect(screen.queryByText(en.circles.shareDialog.notOffered)).toBeNull();
  });

  it("saves the ticked and unticked circles and says where the copy is shared", async () => {
    mocks.mutation.mockResolvedValue(null);
    renderDialog();

    fireEvent.click(box("Puzzle Club"));
    fireEvent.click(box("Old friends"));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: en.circles.shareDialog.save }),
      );
    });

    expect(mocks.mutation.mock.calls).toEqual([
      [SHARE, { circleId: "c_club", copyIds: ["copy_1"] }],
      [UNSHARE, { circleId: "c_was", copyId: "copy_1" }],
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "“Lighthouse” is shared with 2 circles",
    );
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the dialog open and explains a refusal", async () => {
    mocks.mutation.mockRejectedValue(
      new ConvexError({ code: "CannotShareCopy", message: "x" }),
    );
    renderDialog();

    fireEvent.click(box("Puzzle Club"));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: en.circles.shareDialog.save }),
      );
    });

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        en.circles.shareErrors.CannotShareCopy,
      ),
    );
    expect(mocks.onOpenChange).not.toHaveBeenCalled();
  });

  it("warns when members won't see the copy", () => {
    renderDialog({ copy: { ...COPY, availability: CLOSED } });
    expect(screen.getByText(en.circles.shareDialog.notOffered)).toBeTruthy();
    cleanup();

    renderDialog({
      copy: { ...COPY, availability: CLOSED, visibility: "private" },
    });
    expect(screen.getByText(en.circles.shareDialog.private)).toBeTruthy();
  });

  it("points a member without circles to Circles", () => {
    renderDialog({ rows: [] });

    expect(screen.getByText(en.circles.shareDialog.empty)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: en.circles.shareDialog.goToCircles })
        .getAttribute("href"),
    ).toBe("/circles");
  });

  it("says so when the circles can't be read", () => {
    renderDialog({ rows: null });
    expect(screen.getByText(en.circles.shareDialog.loadError)).toBeTruthy();
  });

  it("is translated (nl)", () => {
    renderDialog({ locale: "nl" });
    expect(
      screen.getByRole("heading", { name: "“Lighthouse” delen met kringen" }),
    ).toBeTruthy();
    expect(screen.getByText(nl.circles.shareDialog.viewOnly)).toBeTruthy();
  });
});

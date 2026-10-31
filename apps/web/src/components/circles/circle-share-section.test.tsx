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
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { CircleShareSection } from "./circle-share-section";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const fn = (args: unknown) => mocks.mutation(getFunctionName(ref), args);
    return Object.assign(fn, { withOptimisticUpdate: () => fn });
  },
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));

type Copies = FunctionReturnType<typeof gateway.library.ownedByOwner>;

const CIRCLE = "circle_1";
const ME = "me";
const SHARE = getFunctionName(gateway.sharing.shareCopiesToCircle);
const UNSHARE = getFunctionName(gateway.sharing.unshareCopyFromCircle);

const copy = (
  id: string,
  title: string,
  fields: Partial<Copies[number]> = {},
): Copies[number] =>
  ({
    _id: `doc_${id}`,
    aggregateId: id,
    puzzleId: "p",
    ownerId: ME,
    condition: "good",
    availability: { forTrade: true, forSale: false, forLend: false },
    visibility: "visible",
    createdAt: 0,
    updatedAt: 0,
    puzzle: { title },
    ...fields,
  }) as Copies[number];

const COPIES: Copies = [
  copy("c_light", "Lighthouse"),
  copy("c_wasgij", "Wasgij"),
  copy("c_closed", "Closed box", {
    availability: { forTrade: false, forSale: false, forLend: false },
  }),
  copy("c_secret", "Secret", {
    availability: { forTrade: false, forSale: false, forLend: false },
    visibility: "private",
  }),
];

const renderSection = ({
  shared = ["c_wasgij"],
  locale = "en",
}: { shared?: string[]; locale?: "en" | "nl" } = {}) => {
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
    convexQuery(gateway.library.ownedByOwner, {
      ownerId: ME as never,
      includeUnavailable: true,
    }).queryKey,
    COPIES,
  );
  queryClient.setQueryData(
    convexQuery(gateway.sharing.myCircleShareState, { circleId: CIRCLE })
      .queryKey,
    shared,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <CircleShareSection
          circleId={CIRCLE}
          circleName="Puzzle Club"
          memberId={ME}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const option = (title: string) => {
  const match = screen
    .getAllByRole("option")
    .find((el) => el.textContent?.includes(title));
  if (!match) throw new Error(`no option ${title}`);
  return match;
};

beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.toast.success.mockReset();
  mocks.toast.error.mockReset();
});
afterEach(cleanup);

describe("CircleShareSection", () => {
  it("ticks the copies already shared and says which ones members won't see", () => {
    renderSection();

    expect(option("Wasgij").getAttribute("aria-checked")).toBe("true");
    expect(option("Lighthouse").getAttribute("aria-checked")).toBe("false");
    expect(option("Wasgij").textContent).toContain(en.circles.share.shared);
    expect(option("Closed box").textContent).toContain(
      en.circles.share.notOffered,
    );
    expect(option("Secret").textContent).toContain(en.circles.share.private);
    expect(option("Lighthouse").textContent).not.toContain(
      en.circles.share.notOffered,
    );
    // Nothing staged yet: no save bar.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shares the ticked copies in one call and says so", async () => {
    mocks.mutation.mockResolvedValue({ shared: 2, alreadyShared: 0 });
    renderSection();

    fireEvent.click(option("Lighthouse"));
    fireEvent.click(option("Closed box"));
    expect(option("Lighthouse").getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share 2 puzzles" }));
    });

    expect(mocks.mutation).toHaveBeenCalledTimes(1);
    expect(mocks.mutation).toHaveBeenCalledWith(SHARE, {
      circleId: CIRCLE,
      copyIds: ["c_light", "c_closed"],
    });
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "Shared 2 puzzles with Puzzle Club",
    );
  });

  it("stops sharing an unticked copy", async () => {
    mocks.mutation.mockResolvedValue(null);
    renderSection();

    fireEvent.click(option("Wasgij"));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Stop sharing 1 puzzle" }),
      );
    });

    expect(mocks.mutation).toHaveBeenCalledWith(UNSHARE, {
      circleId: CIRCLE,
      copyId: "c_wasgij",
    });
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "Stopped sharing 1 puzzle with Puzzle Club",
    );
  });

  it("says what saving will do to each changed row", () => {
    renderSection();

    fireEvent.click(option("Lighthouse"));
    fireEvent.click(option("Wasgij"));
    expect(option("Lighthouse").textContent).toContain(
      en.circles.share.willShare,
    );
    expect(option("Wasgij").textContent).toContain(
      en.circles.share.willUnshare,
    );
    expect(option("Wasgij").textContent).not.toContain(
      `${en.circles.share.shared}${en.circles.share.willUnshare}`,
    );
  });

  it("ticking a copy back drops the change, and Clear drops them all", () => {
    renderSection();

    fireEvent.click(option("Wasgij"));
    fireEvent.click(option("Wasgij"));
    expect(screen.queryByRole("button")).toBeNull();

    fireEvent.click(option("Lighthouse"));
    fireEvent.click(
      screen.getByRole("button", { name: en.circles.share.clear }),
    );
    expect(option("Lighthouse").getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("explains a refusal instead of failing silently", async () => {
    mocks.mutation.mockRejectedValue(
      new ConvexError({ code: "CannotShareCopy", message: "x" }),
    );
    renderSection();

    fireEvent.click(option("Lighthouse"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share 1 puzzle" }));
    });

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        en.circles.shareErrors.CannotShareCopy,
      ),
    );
    expect(mocks.toast.success).not.toHaveBeenCalled();
    // The tick stays staged so the member can try again.
    expect(option("Lighthouse").getAttribute("aria-checked")).toBe("true");
  });

  it("is translated (nl)", () => {
    renderSection({ locale: "nl" });

    expect(screen.getByRole("heading").textContent).toBe(
      nl.circles.manage.shareCopy,
    );
    expect(option("Wasgij").textContent).toContain(nl.circles.share.shared);
    fireEvent.click(option("Lighthouse"));
    expect(screen.getByRole("button", { name: "1 puzzel delen" })).toBeTruthy();
  });
});

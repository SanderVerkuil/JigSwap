// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { Route } from "./add";

const mocks = vi.hoisted(() => ({
  // Live query results, keyed by Convex function name; called with the query's args.
  data: new Map<string, (args: unknown) => unknown>(),
  push: vi.fn<(href: string) => void>(),
  createPuzzle: vi.fn<(args: Record<string, unknown>) => Promise<string>>(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    <T,>(options: T) => ({ options }),
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: [string, unknown] }) => {
      const [name, args] = queryKey;
      const read = mocks.data.get(name);
      return { data: args === "skip" || !read ? undefined : read(args) };
    },
  };
});
vi.mock("@convex-dev/react-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    convexQuery: (
      ref: Parameters<typeof getFunctionName>[0],
      args: unknown,
    ) => ({
      queryKey: [getFunctionName(ref), args],
    }),
    // createPuzzle is the page's only Convex mutation; the image import action is never reached.
    useConvexMutation: () => mocks.createPuzzle,
    useConvexAction: () => vi.fn(),
  };
});
vi.mock("@/hooks/use-box-art-check", () => ({
  useBoxArtCheckNotice: () => () => Promise.resolve(),
}));
vi.mock("@/hooks/use-upload-box-art", () => ({
  useUploadBoxArt: () => vi.fn(),
}));
vi.mock("@/components/puzzle-import/use-puzzle-import", () => ({
  usePuzzleImport: () => ({ state: { status: "idle" }, run: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const renderPage = (locale: "en" | "nl" = "en") => {
  const Page = Route.options.component!;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <Page />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const fillRequired = (title: string) => {
  fireEvent.change(screen.getByLabelText("Puzzle Title"), {
    target: { value: title },
  });
  fireEvent.click(screen.getByRole("button", { name: "1000" }));
};

beforeEach(() => {
  mocks.data.clear();
  mocks.push.mockReset();
  mocks.createPuzzle.mockReset();
  mocks.createPuzzle.mockResolvedValue("aggregate-1");
});
afterEach(cleanup);

describe("contribute a puzzle", () => {
  it("leaves difficulty unset until the member picks one", async () => {
    renderPage();
    const difficulty = screen.getByRole("radiogroup", { name: "Difficulty" });
    const checked = Array.from(
      difficulty.querySelectorAll('[role="radio"][aria-checked="true"]'),
    ).map((radio) => radio.textContent);
    expect(checked).toEqual(["Not sure"]);

    fillRequired("Café");
    fireEvent.click(
      screen.getByRole("button", { name: "Contribute a Puzzle" }),
    );

    await waitFor(() => expect(mocks.createPuzzle).toHaveBeenCalledTimes(1));
    const args = mocks.createPuzzle.mock.calls[0][0];
    expect(args).toMatchObject({ title: "Café", pieceCount: 1000 });
    expect(args.difficulty).toBeUndefined();
  });

  it("sends the difficulty the member picked", async () => {
    renderPage();
    fillRequired("Café");
    fireEvent.click(screen.getByRole("radio", { name: "Hard" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Contribute a Puzzle" }),
    );

    await waitFor(() => expect(mocks.createPuzzle).toHaveBeenCalledTimes(1));
    expect(mocks.createPuzzle.mock.calls[0][0].difficulty).toBe("hard");
  });

  it("previews in the member's language and talks about the catalogue, not a shelf", () => {
    renderPage("nl");
    expect(screen.getByText("Titel van je puzzel")).toBeTruthy();
    expect(screen.queryByText("Your puzzle title")).toBeNull();
    expect(screen.queryByText("Brand")).toBeNull();
    expect(
      screen.getByText(
        "Zo komt de puzzel in de catalogus te staan zodra hij is goedgekeurd.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/op je plank/)).toBeNull();
  });
});

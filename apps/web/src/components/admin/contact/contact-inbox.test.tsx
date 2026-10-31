// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { CONTACT_PAGE_SIZE, ContactInbox } from "./contact-inbox";

type ToastOptions = { action?: { label: string; onClick: () => void } };

const mocks = vi.hoisted(() => ({
  paginated: vi.fn<(ref: unknown, args: unknown) => unknown>(),
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn<(message: string, options?: ToastOptions) => void>(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: (ref: unknown, args: unknown) =>
    mocks.paginated(ref, args),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const message = (overrides: Record<string, unknown> = {}) => ({
  _id: "m1",
  _creationTime: 0,
  name: "Mara",
  email: "mara@example.com",
  subject: "swap",
  message: "My trade never arrived.",
  status: "new",
  createdAt: Date.UTC(2026, 9, 3, 12),
  ...overrides,
});

const page = (results: unknown[], status = "Exhausted") => ({
  results,
  status,
  loadMore: vi.fn(),
  isLoading: false,
});

const changes: string[] = [];
beforeEach(() => {
  mocks.paginated.mockReset();
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  changes.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Props = Partial<ComponentProps<typeof ContactInbox>>;
const renderInbox = (props: Props = {}, locale: "en" | "nl" = "en") =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <ContactInbox
          status="new"
          onStatusChange={(status) => changes.push(status)}
          {...props}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );

const lastArgs = () => mocks.paginated.mock.lastCall?.[1];

describe("ContactInbox", () => {
  it("asks the server for the filtered page: new, handled, or everything", () => {
    mocks.paginated.mockReturnValue(page([message()]));
    renderInbox({ status: "new" });
    expect(lastArgs()).toEqual({ status: "new" });
    cleanup();

    renderInbox({ status: "handled" });
    expect(lastArgs()).toEqual({ status: "handled" });
    cleanup();

    renderInbox({ status: "all" });
    expect(lastArgs()).toEqual({});
  });

  it("marks the active filter and reports a new one", () => {
    mocks.paginated.mockReturnValue(page([message()]));
    renderInbox({ status: "handled" });
    const pressed = (name: string) =>
      screen.getByRole("button", { name }).getAttribute("aria-pressed");
    expect(pressed("Handled")).toBe("true");
    expect(pressed("New")).toBe("false");
    expect(pressed("All")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(changes).toEqual(["all", "new"]);
  });

  it("shows how many new messages wait, '50+' past the server's cap", () => {
    mocks.paginated.mockReturnValue(page([message()]));
    renderInbox({ newCount: { count: 3, capped: false } });
    expect(screen.getByRole("button", { name: "New 3" })).toBeTruthy();
    cleanup();

    renderInbox({ newCount: { count: 50, capped: true } });
    expect(screen.getByRole("button", { name: "New 50+" })).toBeTruthy();
  });

  it("loads the next page on demand", () => {
    const result = page([message()], "CanLoadMore");
    mocks.paginated.mockReturnValue(result);
    renderInbox();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(result.loadMore).toHaveBeenCalledWith(CONTACT_PAGE_SIZE);
  });

  it("says which filter is empty (nl)", () => {
    mocks.paginated.mockReturnValue(page([]));
    renderInbox({ status: "new" }, "nl");
    expect(screen.getByText("Geen nieuwe contactberichten.")).toBeTruthy();
    cleanup();

    renderInbox({ status: "handled" }, "nl");
    expect(
      screen.getByText("Nog geen afgehandelde contactberichten."),
    ).toBeTruthy();
  });

  it("shows a retryable error, not the loading state, when a page fails", () => {
    // The boundary logs what it caught; keep the test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.paginated.mockImplementation(() => {
      throw new Error("Forbidden");
    });
    renderInbox();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(en.admin.contact.loading)).toBeNull();

    mocks.paginated.mockReset().mockReturnValue(page([message()]));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("My trade never arrived.")).toBeTruthy();
  });

  it("encodes the sender's address in the reply link (SEC-78)", () => {
    const email = "a?bcc=x%40evil.com@site.nl";
    mocks.paginated.mockReturnValue(page([message({ email })]));
    renderInbox();
    const href = screen.getByRole("link", { name: email }).getAttribute("href");
    expect(href).toBe("mailto:a%3Fbcc%3Dx%2540evil.com@site.nl");
  });

  it("marks a new message handled and offers Undo, which puts it back to new", async () => {
    mocks.paginated.mockReturnValue(page([message()]));
    renderInbox();
    fireEvent.click(screen.getByRole("button", { name: "Mark as handled" }));
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(
        "contact/markContactMessageHandled:markContactMessageHandled",
        { id: "m1" },
      ),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Message marked as handled",
        expect.anything(),
      ),
    );

    const undo = mocks.toastSuccess.mock.lastCall?.[1]?.action;
    expect(undo?.label).toBe("Undo");
    undo!.onClick();
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenLastCalledWith(
        "contact/reopenContactMessage:reopenContactMessage",
        { id: "m1" },
      ),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenLastCalledWith(
        "Message moved back to New",
      ),
    );
  });

  it("says when the undo fails (nl)", async () => {
    mocks.paginated.mockReturnValue(page([message()]));
    renderInbox({}, "nl");
    fireEvent.click(
      screen.getByRole("button", { name: "Markeren als afgehandeld" }),
    );
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    const undo = mocks.toastSuccess.mock.lastCall?.[1]?.action;
    expect(undo?.label).toBe("Ongedaan maken");
    mocks.mutation.mockRejectedValue(new Error("boom"));
    undo!.onClick();
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Kon het bericht niet terugzetten naar Nieuw",
      ),
    );
  });
});

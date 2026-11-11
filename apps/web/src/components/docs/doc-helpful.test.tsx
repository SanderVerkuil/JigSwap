// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { DocHelpful } from "./doc-helpful";

const mocks = vi.hoisted(() => ({
  submit: vi.fn<(args: unknown) => Promise<null>>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation: () => mocks.submit,
}));

const renderHelpful = (locale: "en" | "nl" = "en") =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <DocHelpful slug="getting-started/first" />
      </IntlProvider>
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// The thanks showed in the box and again in a toast, so the reader was thanked twice.
describe("DocHelpful", () => {
  it("thanks a Yes once, in place of the question", async () => {
    mocks.submit.mockResolvedValue(null);
    renderHelpful();

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    const thanks = await screen.findByRole("status");
    expect(thanks.textContent).toBe(en.marketing.docs.helpfulThanks);
    expect(mocks.submit.mock.calls[0]?.[0]).toEqual({
      slug: "getting-started/first",
      helpful: true,
      locale: "en",
    });
    expect(screen.queryByRole("button")).toBeNull();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it.each(["en", "nl"] as const)(
    "thanks a Not really once, in the same place, with its own words (%s)",
    async (locale) => {
      mocks.submit.mockResolvedValue(null);
      const messages = locale === "en" ? en : nl;
      renderHelpful(locale);

      fireEvent.click(
        screen.getByRole("button", { name: messages.marketing.docs.helpfulNo }),
      );
      fireEvent.change(
        screen.getByRole("textbox", {
          name: messages.marketing.docs.helpfulCommentLabel,
        }),
        { target: { value: "  The steps were out of date.  " } },
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: messages.marketing.docs.helpfulSend,
        }),
      );

      const thanks = await screen.findByRole("status");
      expect(thanks.textContent).toBe(
        messages.marketing.docs.helpfulThanksNegative,
      );
      expect(mocks.submit.mock.calls[0]?.[0]).toEqual({
        slug: "getting-started/first",
        helpful: false,
        comment: "The steps were out of date.",
        locale,
      });
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
    },
  );

  it("keeps the buttons and says so when sending fails", async () => {
    mocks.submit.mockRejectedValue(new Error("offline"));
    renderHelpful();

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        en.marketing.docs.helpfulError,
      ),
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Yes" })).toBeTruthy();
  });
});

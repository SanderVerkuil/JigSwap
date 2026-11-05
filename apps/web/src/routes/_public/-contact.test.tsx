// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { gateway } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
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
import nl from "../../../locales/nl.json";
import { Route } from "./contact";

const SUBMIT = getFunctionName(gateway.contact.submit);

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

const renderPage = (locale: "en" | "nl" = "en") => {
  const Page = Route.options.component!;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider
        locale={locale}
        messages={locale === "nl" ? nl : en}
        timeZone="Europe/Amsterdam"
      >
        <Page />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const fillAndSend = (submitLabel: string) => {
  fireEvent.change(document.getElementById("contact-name")!, {
    target: { value: "Mara" },
  });
  fireEvent.change(document.getElementById("contact-email")!, {
    target: { value: "mara@example.com" },
  });
  fireEvent.change(document.getElementById("contact-message")!, {
    target: { value: "A perfectly reasonable message." },
  });
  fireEvent.click(screen.getByRole("button", { name: submitLabel }));
};

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

describe("contact form", () => {
  it("sends the message with a supported locale", async () => {
    renderPage("nl");
    fillAndSend("Verstuur bericht");

    await screen.findByText("Bericht verstuurd!");
    expect(mocks.mutation).toHaveBeenCalledWith(SUBMIT, {
      name: "Mara",
      email: "mara@example.com",
      subject: "swap",
      message: "A perfectly reasonable message.",
      locale: "nl",
    });
  });

  it("explains a busy form and offers the email address instead", async () => {
    mocks.mutation.mockRejectedValue(
      new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 }),
    );
    renderPage();
    fillAndSend("Send message");

    const message = await screen.findByText(
      /We're receiving a lot of messages right now/,
    );
    expect(message.textContent).toBe(
      "We're receiving a lot of messages right now. Try again later, or email us at hello@jigswap.site.",
    );
    const mail = screen.getAllByRole("link", { name: "hello@jigswap.site" });
    expect(message.contains(mail.at(-1)!)).toBe(true);
    expect(mail.at(-1)!.getAttribute("href")).toBe("mailto:hello@jigswap.site");
  });

  it("keeps the generic error for any other failure", async () => {
    mocks.mutation.mockRejectedValue(new Error("offline"));
    renderPage();
    fillAndSend("Send message");

    await screen.findByText(
      "Something went wrong while sending — please try again.",
    );
    await waitFor(() =>
      expect(screen.queryByText(/a lot of messages/)).toBeNull(),
    );
  });
});

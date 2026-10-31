// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ConvexError } from "convex/values";
import type { ComponentProps, ComponentType } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { Route } from "./contact";

// Never reach the backend: gateway.contact.submit is a local spy, so the spy
// only sees calls made to that mutation.
const backend = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation: (ref: unknown) => ref,
}));
vi.mock("@/gateway", () => ({
  gateway: { contact: { submit: backend.submit } },
}));

// The route module only needs its options back; Link renders a plain anchor.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
  Link: ({ to, ...rest }: ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...rest} />
  ),
}));

const ContactPage = (
  Route as unknown as { options: { component: ComponentType } }
).options.component;
const copy = en.marketing.contactPage;

const renderPage = (locale: "en" | "nl" = "en") =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider
        locale={locale}
        messages={locale === "nl" ? nl : en}
        timeZone="Europe/Amsterdam"
      >
        <ContactPage />
      </IntlProvider>
    </QueryClientProvider>,
  );

const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;

const describedBy = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent);

const fillValid = () => {
  fireEvent.change(field(copy.formName), { target: { value: "Ada" } });
  fireEvent.change(field(copy.formEmail), {
    target: { value: "ada@example.com" },
  });
  fireEvent.change(field(copy.formMessage), {
    target: { value: "Hello there, a question about a swap." },
  });
};

const send = () =>
  fireEvent.click(screen.getByRole("button", { name: copy.submit }));

afterEach(() => {
  cleanup();
  backend.submit.mockReset();
});

describe("contact form validation", () => {
  it("moves focus to the name field and describes it with its error when sent empty", () => {
    renderPage();
    send();

    const name = field(copy.formName);
    expect(document.activeElement).toBe(name);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(name)).toEqual([copy.errorName]);
    expect(describedBy(field(copy.formEmail))).toEqual([copy.errorEmail]);
    expect(describedBy(field(copy.formMessage))).toEqual([copy.errorMessage]);
    expect(backend.submit).not.toHaveBeenCalled();
  });

  it("focuses the first invalid field, not always the first field", () => {
    renderPage();
    fireEvent.change(field(copy.formName), { target: { value: "Ada" } });
    send();

    const email = field(copy.formEmail);
    expect(document.activeElement).toBe(email);
    expect(describedBy(field(copy.formName))).toEqual([]);
    expect(describedBy(email)).toEqual([copy.errorEmail]);
  });
});

describe("contact form subject", () => {
  it("is a labelled radio group whose checked state follows the selection", async () => {
    backend.submit.mockResolvedValue(null);
    renderPage();

    const group = screen.getByRole("group", { name: copy.formSubject });
    const radios = Array.from(
      group.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    );
    expect(radios).toHaveLength(4);
    const swap = screen.getByRole("radio", { name: copy.subjectSwap });
    const account = screen.getByRole("radio", { name: copy.subjectAccount });
    expect((swap as HTMLInputElement).checked).toBe(true);
    expect((account as HTMLInputElement).checked).toBe(false);

    fireEvent.click(account);
    expect((account as HTMLInputElement).checked).toBe(true);
    expect((swap as HTMLInputElement).checked).toBe(false);

    fillValid();
    send();
    await waitFor(() => expect(backend.submit).toHaveBeenCalledTimes(1));
    expect(backend.submit.mock.calls[0]?.[0]).toMatchObject({
      subject: "account",
    });
  });
});

describe("contact form", () => {
  it("sends the message with a supported locale", async () => {
    backend.submit.mockResolvedValue(null);
    renderPage("nl");
    fireEvent.change(field(nl.marketing.contactPage.formName), {
      target: { value: "Mara" },
    });
    fireEvent.change(field(nl.marketing.contactPage.formEmail), {
      target: { value: "mara@example.com" },
    });
    fireEvent.change(field(nl.marketing.contactPage.formMessage), {
      target: { value: "A perfectly reasonable message." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verstuur bericht" }));

    await screen.findByText("Bericht verstuurd!");
    expect(backend.submit.mock.calls[0]?.[0]).toEqual({
      name: "Mara",
      email: "mara@example.com",
      subject: "swap",
      message: "A perfectly reasonable message.",
      locale: "nl",
    });
  });

  it("explains a busy form and offers the email address instead", async () => {
    backend.submit.mockRejectedValue(
      new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 }),
    );
    renderPage();
    fillValid();
    send();

    const message = await screen.findByText(
      /We're receiving a lot of messages right now/,
    );
    expect(message.textContent).toBe(
      "We're receiving a lot of messages right now. Try again later, or email us at hello@jigswap.site.",
    );
    expect(
      within(message)
        .getByRole("link", { name: "hello@jigswap.site" })
        .getAttribute("href"),
    ).toBe("mailto:hello@jigswap.site");
  });

  it("keeps the generic error for any other failure", async () => {
    backend.submit.mockRejectedValue(new Error("offline"));
    renderPage();
    fillValid();
    send();

    await screen.findByText(
      "Something went wrong while sending — please try again.",
    );
    await waitFor(() =>
      expect(screen.queryByText(/a lot of messages/)).toBeNull(),
    );
  });
});

describe("contact form outcome", () => {
  it("announces a failed send", async () => {
    backend.submit.mockRejectedValue(new Error("offline"));
    renderPage();
    fillValid();
    send();

    expect((await screen.findByRole("alert")).textContent).toBe(
      copy.errorSubmit,
    );
  });

  it("announces a busy form with the same alert", async () => {
    backend.submit.mockRejectedValue(
      new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 }),
    );
    renderPage();
    fillValid();
    send();

    expect((await screen.findByRole("alert")).textContent).toContain(
      copy.emailValue,
    );
  });

  it("moves focus to the email field when the server refuses the address", async () => {
    backend.submit.mockRejectedValue(
      new ConvexError({ code: "invalid_email" }),
    );
    renderPage();
    fillValid();
    send();

    const email = field(copy.formEmail);
    await waitFor(() => expect(document.activeElement).toBe(email));
    expect(describedBy(email)).toEqual([copy.errorEmail]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("moves focus to the confirmation heading after a successful send", async () => {
    backend.submit.mockResolvedValue(null);
    renderPage();
    fillValid();
    send();

    const heading = await screen.findByRole("heading", {
      level: 2,
      name: copy.sentTitle,
    });
    expect(document.activeElement).toBe(heading);
  });

  it("returns focus to the name field when starting another message", async () => {
    backend.submit.mockResolvedValue(null);
    renderPage();
    fillValid();
    send();

    fireEvent.click(
      await screen.findByRole("button", { name: copy.sentAgain }),
    );
    const name = field(copy.formName);
    expect(name.value).toBe("");
    expect(document.activeElement).toBe(name);
  });
});

describe("contact form details", () => {
  it("lets browsers autofill the name and email", () => {
    renderPage();
    expect(field(copy.formName).getAttribute("autocomplete")).toBe("name");
    expect(field(copy.formEmail).getAttribute("autocomplete")).toBe("email");
  });

  it("links the privacy note to the privacy policy", () => {
    renderPage("nl");
    expect(
      screen.getByRole("link", { name: "privacybeleid" }).getAttribute("href"),
    ).toBe("/privacy");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { isNewAccount, useDashboardGreeting } from "./greeting";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-10-30T12:00:00Z");

const clerkUser = vi.hoisted(() => ({
  current: undefined as
    { firstName: string | null; createdAt: Date | null } | undefined,
}));
vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: clerkUser.current }),
}));

describe("isNewAccount", () => {
  it("is true during the account's first day", () => {
    expect(isNewAccount(new Date(+NOW - 5 * 60 * 1000), NOW)).toBe(true);
    expect(isNewAccount(new Date(+NOW - 23 * HOUR), NOW)).toBe(true);
  });

  it("is false from 24 hours on", () => {
    expect(isNewAccount(new Date(+NOW - 24 * HOUR), NOW)).toBe(false);
    expect(isNewAccount(new Date(+NOW - 30 * 24 * HOUR), NOW)).toBe(false);
  });

  it("treats a creation time just ahead of this clock as new", () => {
    expect(isNewAccount(new Date(+NOW + 2_000), NOW)).toBe(true);
  });

  it("is false when the creation time is unknown", () => {
    expect(isNewAccount(null, NOW)).toBe(false);
    expect(isNewAccount(undefined, NOW)).toBe(false);
  });
});

function Greeting() {
  return <h1>{useDashboardGreeting()}</h1>;
}

const render = (locale: "en" | "nl" = "en") =>
  renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
      now={NOW}
    >
      <Greeting />
    </IntlProvider>,
  );

describe("useDashboardGreeting", () => {
  beforeEach(() => {
    clerkUser.current = undefined;
  });

  it("welcomes a member on their first day without the 'back'", () => {
    clerkUser.current = {
      firstName: "Henk",
      createdAt: new Date(+NOW - HOUR),
    };
    expect(render()).toBe("<h1>Welcome, Henk! 🧩</h1>");
    expect(render("nl")).toBe("<h1>Welkom, Henk! 🧩</h1>");
  });

  it("welcomes a returning member back", () => {
    clerkUser.current = {
      firstName: "Henk",
      createdAt: new Date(+NOW - 3 * 24 * HOUR),
    };
    expect(render()).toBe("<h1>Welcome back, Henk! 🧩</h1>");
    expect(render("nl")).toBe("<h1>Welkom terug, Henk! 🧩</h1>");
  });

  it("has a nameless form for both", () => {
    clerkUser.current = { firstName: null, createdAt: new Date(+NOW - HOUR) };
    expect(render()).toBe("<h1>Welcome! 🧩</h1>");
    expect(render("nl")).toBe("<h1>Welkom! 🧩</h1>");
    clerkUser.current = undefined;
    expect(render()).toBe("<h1>Welcome back! 🧩</h1>");
  });
});

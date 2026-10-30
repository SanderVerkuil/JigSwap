// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { ErrorBoundary } from "./error-boundary";
import { LoadingState, PageLoading } from "./loading";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Loading and error states speak the member's language when the caller passes no text (UX-64).
const catalogs = { en, nl } as const;
function inLocale(locale: keyof typeof catalogs) {
  return function LocaleWrapper({ children }: { children: ReactNode }) {
    return (
      <IntlProvider
        locale={locale}
        messages={catalogs[locale]}
        timeZone="Europe/Amsterdam"
      >
        {children}
      </IntlProvider>
    );
  };
}

function Boom(): never {
  throw new Error("boom");
}

describe.each(["en", "nl"] as const)("in %s", (locale) => {
  const messages = catalogs[locale];

  it("defaults the loading message to the catalogue's loading text", () => {
    render(
      <>
        <PageLoading />
        <LoadingState />
      </>,
      { wrapper: inLocale(locale) },
    );
    expect(screen.getAllByText(messages.common.loading)).toHaveLength(2);
  });

  it("keeps a caller's own loading message", () => {
    render(<PageLoading message="Fetching circles" />, {
      wrapper: inLocale(locale),
    });
    expect(screen.getByText("Fetching circles")).toBeTruthy();
    expect(screen.queryByText(messages.common.loading)).toBeNull();
  });

  it("renders the default error card from the catalogue", () => {
    // React reports the caught error; keep the test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
      { wrapper: inLocale(locale) },
    );
    const copy = messages.common.errorBoundary;
    expect(screen.getByText(copy.title)).toBeTruthy();
    expect(screen.getByText(copy.description)).toBeTruthy();
    expect(screen.getByRole("button", { name: copy.tryAgain })).toBeTruthy();
    expect(screen.getByRole("button", { name: copy.reload })).toBeTruthy();
  });
});

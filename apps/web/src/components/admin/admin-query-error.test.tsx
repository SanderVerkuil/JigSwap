// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { AdminQueryError } from "./admin-query-error";

afterEach(cleanup);

const renderIn = (
  messages: typeof en,
  locale: string,
  props: Parameters<typeof AdminQueryError>[0],
) =>
  render(
    <IntlProvider locale={locale} messages={messages}>
      <AdminQueryError {...props} />
    </IntlProvider>,
  );

describe("AdminQueryError", () => {
  it("announces the failure and retries on click", () => {
    const onRetry = vi.fn();
    renderIn(en, "en", { onRetry });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Something went wrong");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("disables Retry while a retry is in flight", () => {
    const onRetry = vi.fn();
    renderIn(en, "en", { onRetry, retrying: true });

    const button = screen.getByRole("button", { name: "Try again" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("is translated to Dutch", () => {
    renderIn(nl, "nl", { onRetry: vi.fn() });

    expect(screen.getByRole("alert").textContent).toContain("Er ging iets mis");
    expect(
      screen.getByRole("button", { name: "Opnieuw proberen" }),
    ).toBeTruthy();
  });
});

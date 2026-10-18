// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { PresenceDot } from "./presence-dot";
import type { PresenceStatus } from "./use-presence";

const renderDot = (
  status: PresenceStatus | undefined,
  locale: "en" | "nl" = "en",
) =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <PresenceDot status={status} />
    </IntlProvider>,
  );

afterEach(cleanup);

describe("PresenceDot", () => {
  it.each<[PresenceStatus, "en" | "nl", string]>([
    ["online", "en", "Online"],
    ["away", "en", "Away"],
    ["online", "nl", "Online"],
    ["away", "nl", "Afwezig"],
  ])("labels %s in %s as %s for screen readers", (status, locale, label) => {
    renderDot(status, locale);
    const text = screen.getByText(label);
    expect(text.className).toContain("sr-only");
    expect(text.parentElement?.dataset.presence).toBe(status);
  });

  it("uses a different shape for away, not only a different colour", () => {
    const { container, unmount } = renderDot("online");
    const online = container.querySelector("[data-presence]")?.className;
    unmount();
    const away =
      renderDot("away").container.querySelector("[data-presence]")?.className;
    expect(online).not.toContain("linear-gradient");
    expect(away).toContain("linear-gradient");
  });

  it("renders nothing when offline or unknown", () => {
    const { container } = renderDot(undefined);
    expect(container.innerHTML).toBe("");
  });
});

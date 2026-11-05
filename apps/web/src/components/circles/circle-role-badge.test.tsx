// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import { CircleRoleBadge } from "./circle-role-badge";
import type { CirclePermissionLevel } from "./circle-seat";

const renderBadge = ({
  isOwner = false,
  permission = "ViewOnly",
  interactive = false,
  locale = "en",
}: {
  isOwner?: boolean;
  permission?: CirclePermissionLevel;
  interactive?: boolean;
  locale?: "en" | "nl";
}) =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <CircleRoleBadge
        isOwner={isOwner}
        permission={permission}
        interactive={interactive}
      />
    </IntlProvider>,
  );

const tooltipText = () =>
  screen.queryAllByRole("tooltip").map((el) => el.textContent);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CircleRoleBadge", () => {
  it.each([
    ["ViewOnly", "View only", "Alleen bekijken"],
    ["Exchange", "Can exchange", "Mag ruilen"],
    ["Admin", "Admin", "Beheerder"],
  ] as const)(
    "names a member's %s permission, not just 'Member'",
    (permission, english, dutch) => {
      renderBadge({ permission });
      expect(screen.getByText(english)).toBeTruthy();
      cleanup();
      renderBadge({ permission, locale: "nl" });
      expect(screen.getByText(dutch)).toBeTruthy();
    },
  );

  it("names the owner's seat Owner, whatever its permission", () => {
    renderBadge({ isOwner: true, permission: "Admin" });
    expect(screen.getByText("Owner")).toBeTruthy();
    expect(screen.queryByText("Admin")).toBeNull();
  });

  it("is plain text by default, so it can sit inside a link", () => {
    renderBadge({ permission: "Exchange" });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Can exchange").tagName).toBe("SPAN");
  });

  it("explains the seat in a tooltip on hover", () => {
    vi.useFakeTimers();
    renderBadge({ permission: "ViewOnly" });
    const badge = screen.getByText("View only");
    fireEvent.pointerMove(badge, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(tooltipText()).toContain(en.circles.roleHints.ViewOnly);
  });

  it("is a button on the circle's page: keyboard focus explains it", () => {
    renderBadge({ permission: "Exchange", interactive: true });
    const badge = screen.getByRole("button", { name: "Can exchange" });
    expect(badge.getAttribute("type")).toBe("button");
    act(() => badge.focus());
    expect(tooltipText()).toContain(en.circles.roleHints.Exchange);
  });

  it("opens on a tap, since touch has no hover", () => {
    renderBadge({ isOwner: true, permission: "Admin", interactive: true });
    const badge = screen.getByRole("button", { name: "Owner" });
    fireEvent.pointerDown(badge, { pointerType: "touch" });
    fireEvent.click(badge);
    expect(tooltipText()).toContain(en.circles.roleHints.Owner);
  });

  it("has a hint for every seat in every catalog", () => {
    for (const catalog of [en, nl, source]) {
      expect(Object.keys(catalog.circles.roleHints).sort()).toEqual([
        "Admin",
        "Exchange",
        "Owner",
        "ViewOnly",
      ]);
    }
    expect(source.circles).toEqual(en.circles);
    expect(nl.circles.roleHints.ViewOnly).toBe(
      "Je ziet de puzzels die hier gedeeld zijn, maar kunt ze niet aanvragen en geen eigen puzzels delen.",
    );
  });
});

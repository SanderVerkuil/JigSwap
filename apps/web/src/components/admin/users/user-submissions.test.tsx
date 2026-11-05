// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { UserSubmissions } from "./user-submissions";

// Router-free Link: the test asserts the rendered href, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children?: ReactNode;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      )}
      {...rest}
    >
      {children}
    </a>
  ),
}));

afterEach(cleanup);

type Submissions = ComponentProps<typeof UserSubmissions>["submissions"];
const submissions = [
  { _id: "p1", title: "Starry Night", status: "approved", createdAt: 0 },
  { _id: "p2", title: "Night Watch", status: "disabled", createdAt: 0 },
] as unknown as Submissions;

const renderList = (messages: typeof en, locale: string) =>
  render(
    <IntlProvider locale={locale} messages={messages} timeZone="UTC">
      <UserSubmissions submissions={submissions} />
    </IntlProvider>,
  );

describe("UserSubmissions", () => {
  it("links each submission to its admin puzzle page", () => {
    renderList(en, "en");
    expect(
      screen.getByRole("link", { name: /Starry Night/ }).getAttribute("href"),
    ).toBe("/admin/puzzles/p1");
    expect(
      screen.getByRole("link", { name: /Night Watch/ }).getAttribute("href"),
    ).toBe("/admin/puzzles/p2");
  });

  it("labels a disabled puzzle instead of showing the raw status", () => {
    renderList(en, "en");
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.queryByText("disabled")).toBeNull();
    cleanup();

    renderList(nl as typeof en, "nl");
    expect(screen.getByText("Uitgeschakeld")).toBeTruthy();
  });

  it("says so when the member submitted nothing", () => {
    render(
      <IntlProvider locale="en" messages={en} timeZone="UTC">
        <UserSubmissions submissions={[]} />
      </IntlProvider>,
    );
    expect(
      screen.getByText(en.admin.users.detail.submissionsEmpty),
    ).toBeTruthy();
  });
});

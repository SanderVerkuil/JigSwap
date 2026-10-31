// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { UsersTable } from "./users-table";

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
// The row actions talk to Convex; stand-ins mark where they render.
vi.mock("./user-role-action", () => ({
  UserRoleAction: ({ name }: { name: string }) => (
    <button type="button">role:{name}</button>
  ),
}));
vi.mock("./community-profile-action", () => ({
  CommunityProfileAction: ({ name }: { name: string }) => (
    <button type="button">profile:{name}</button>
  ),
}));

afterEach(cleanup);

type Users = ComponentProps<typeof UsersTable>["users"];
const users = [
  {
    _id: "u1",
    _creationTime: 0,
    name: "Marieke van der Berg-Jansen",
    username: "marieke",
    email: "marieke.vanderberg@puzzelvereniging.nl",
    isActive: true,
    role: "admin",
    ownedCopyCount: 14,
    createdAt: 0,
  },
  {
    _id: "u2",
    _creationTime: 0,
    name: "Jan",
    isActive: false,
    ownedCopyCount: 0,
    createdAt: 0,
  },
] as unknown as Users;

const renderTable = () =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="UTC">
      <UsersTable users={users} />
    </IntlProvider>,
  );

const columnIndex = (name: string) =>
  screen
    .getAllByRole("columnheader")
    .findIndex((th) => th.textContent === name);

const cellsOf = (name: string) => {
  const index = columnIndex(name);
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[index]);
};

describe("UsersTable", () => {
  it("links each member to their admin page", () => {
    renderTable();
    expect(
      screen
        .getByRole("link", { name: /Marieke van der Berg-Jansen/ })
        .getAttribute("href"),
    ).toBe("/admin/users/u1");
    expect(
      screen.getByRole("link", { name: /Jan$/ }).getAttribute("href"),
    ).toBe("/admin/users/u2");
  });

  it("drops the wide columns on a narrow table and repeats email and badges under the name", () => {
    renderTable();
    const table = screen.getByRole("table");
    // The breakpoints follow the table's own width (the dashboard sidebar takes its share).
    expect(table.parentElement?.className).toContain("@container");

    for (const [column, from] of [
      ["Status", "@lg"],
      ["Role", "@lg"],
      ["Email", "@3xl"],
      ["Joined", "@4xl"],
      ["Copies", "@4xl"],
    ]) {
      const th = screen.getByRole("columnheader", { name: column });
      expect(th.className).toContain("hidden");
      expect(th.className).toContain(`${from}:table-cell`);
      for (const td of cellsOf(column)) {
        expect(td.className).toContain("hidden");
        expect(td.className).toContain(`${from}:table-cell`);
      }
    }

    const [marieke, jan] = cellsOf("Member");
    // The email shows under the name until its column does.
    const email = within(marieke).getByText(
      "marieke.vanderberg@puzzelvereniging.nl",
    );
    expect(email.className).toContain("@3xl:hidden");
    // A long address wraps instead of widening the table.
    expect(email.className).toContain("[overflow-wrap:anywhere]");
    // Status and role badges show under the name until their columns do.
    const badges = within(marieke).getByText("Active").parentElement;
    expect(badges?.className).toContain("@lg:hidden");
    expect(within(marieke).getByText("Admin")).toBeTruthy();
    expect(within(jan).getByText("Inactive")).toBeTruthy();
    // A member without an email gets no empty line.
    expect(within(jan).queryByText(/@/)).toBeNull();
  });

  it("keeps the row actions to the widest table; narrower screens use the member page", () => {
    renderTable();
    const actions = screen.getByRole("columnheader", { name: "Actions" });
    expect(actions.className).toContain("hidden");
    expect(actions.className).toContain("@5xl:table-cell");
    const cell = screen.getByText("role:Jan").closest("td");
    expect(cell?.className).toContain("hidden");
    expect(cell?.className).toContain("@5xl:table-cell");
    expect(screen.getByText("profile:Jan")).toBeTruthy();
  });
});

// @vitest-environment happy-dom
// The account row: Clerk's avatar is the menu's one keyboard control, in the expanded sidebar as on
// the rail (where the name row is hidden); the name beside it is a bigger pointer target for the
// same menu, so it adds no second Tab stop on every page.
import {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { UserFooter } from "./user-footer";

vi.mock("@/compat/clerk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/compat/clerk")>()),
  useUser: () => ({
    user: {
      firstName: "Henk",
      lastName: "Pieterszoon",
      primaryEmailAddress: { emailAddress: "henk@example.com" },
    },
  }),
}));
vi.mock("@/lib/member-display-name", () => ({
  useMemberDisplayName: () => (member: { name: string }) => member.name,
}));
vi.mock("./preferences", () => ({
  useShellPreferences: () => ({ hideEmail: false }),
}));
vi.mock("./shell-user-button", () => ({
  ShellUserButton: () => (
    <button type="button" className="cl-userButtonTrigger">
      Open user menu
    </button>
  ),
}));

afterEach(cleanup);

const renderFooter = (overlay = false) =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <SidebarProvider overlay={overlay}>
        <SidebarTrigger />
        <Sidebar collapsible="icon">
          <UserFooter />
        </Sidebar>
      </SidebarProvider>
    </IntlProvider>,
  );

const nameRow = () => screen.getByRole("button", { name: /Henk Pieterszoon/ });

describe("UserFooter", () => {
  it("keeps Clerk's avatar as the only Tab stop for the menu", () => {
    renderFooter();
    expect(nameRow().getAttribute("tabindex")).toBe("-1");
    expect(
      screen
        .getByRole("button", { name: "Open user menu" })
        .getAttribute("tabindex"),
    ).toBeNull();
  });

  it("still opens the menu from a click on the name", () => {
    renderFooter();
    const open = vi.fn();
    screen
      .getByRole("button", { name: "Open user menu" })
      .addEventListener("click", open);
    fireEvent.pointerDown(nameRow());
    fireEvent.click(nameRow());
    expect(open).toHaveBeenCalledOnce();
  });

  // Clerk portals its menu out of the modal sheet, where it can't take a tap or keep focus.
  it("stays out of the sidebar's sheet", () => {
    renderFooter(true);
    fireEvent.click(
      screen.getByRole("button", {
        name: en.shell.toggleSidebar,
        hidden: true,
      }),
    );
    expect(screen.getByRole("dialog").textContent).not.toContain("Henk");
  });
});

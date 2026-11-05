// @vitest-environment happy-dom
// UX-05: on a touch screen (coarse pointer) the sidebar's rows, labels and icon rail are 44px
// targets; with a mouse they keep the compact 32px desktop sizing. Asserted through the class
// contract, since happy-dom does not evaluate media queries.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import {
  Sidebar,
  SidebarContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "./sidebar";

afterEach(cleanup);

function renderSidebar() {
  return render(
    <SidebarProvider>
      <SidebarGroupLabel>My Library</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton>Messages</SidebarMenuButton>
          <SidebarMenuBadge>3</SidebarMenuBadge>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarProvider>,
  );
}

function classesOf(element: Element | null) {
  return (element?.getAttribute("class") ?? "").split(/\s+/);
}

describe("sidebar touch sizing", () => {
  it("makes menu rows 44px tall on coarse pointers and keeps 32px otherwise", () => {
    renderSidebar();
    const classes = classesOf(screen.getByRole("button", { name: "Messages" }));
    expect(classes).toContain("h-8");
    expect(classes).toContain("pointer-coarse:h-11");
  });

  it("makes icon-rail buttons 44px and keeps their label clipped on coarse pointers", () => {
    renderSidebar();
    const classes = classesOf(screen.getByRole("button", { name: "Messages" }));
    expect(classes).toContain("group-data-[collapsible=icon]:size-8!");
    expect(classes).toContain(
      "pointer-coarse:group-data-[collapsible=icon]:size-11!",
    );
    // Centred icon (14px padding) with the label pushed past the 44px edge.
    expect(classes).toContain(
      "pointer-coarse:group-data-[collapsible=icon]:p-3.5!",
    );
    expect(classes).toContain(
      "pointer-coarse:group-data-[collapsible=icon]:gap-4",
    );
  });

  it("widens the icon rail on coarse pointers so the 44px buttons fit", () => {
    const { container } = renderSidebar();
    const wrapper = container.querySelector('[data-slot="sidebar-wrapper"]');
    const classes = classesOf(wrapper);
    expect(classes).toContain("[--sidebar-width-icon:3rem]");
    expect(classes).toContain("pointer-coarse:[--sidebar-width-icon:3.75rem]");
    // An inline value would beat the coarse-pointer class.
    expect(
      (wrapper as HTMLElement).style.getPropertyValue("--sidebar-width-icon"),
    ).toBe("");
  });

  it("gives group labels the same 44px row on coarse pointers", () => {
    renderSidebar();
    const classes = classesOf(screen.getByText("My Library"));
    expect(classes).toContain("h-8");
    expect(classes).toContain("pointer-coarse:h-11");
    expect(classes).toContain(
      "pointer-coarse:group-data-[collapsible=icon]:-mt-11",
    );
  });

  it("keeps the count badge centred on the taller row", () => {
    renderSidebar();
    const classes = classesOf(screen.getByText("3"));
    expect(classes).toContain(
      "pointer-coarse:peer-data-[size=default]/menu-button:top-3",
    );
  });
});

describe("sidebar group label on the icon rail", () => {
  // UX-159: a group label that links to its hub must not stay a Tab stop while the rail hides it.
  it("is hidden from focus and assistive tech, not just faded, while collapsed", () => {
    renderSidebar();
    const classes = classesOf(screen.getByText("My Library"));
    expect(classes).toContain("group-data-[collapsible=icon]:opacity-0");
    expect(classes).toContain("group-data-[collapsible=icon]:invisible");
    // Visibility transitions with the fade, so it only switches once the label has faded out.
    expect(classes).toContain("transition-[margin,opacity,visibility]");
  });
});

describe("sidebar content on the icon rail", () => {
  // The rail is the default below 1024px, so a short window (a phone in landscape, a small tablet)
  // leaves it shorter than its links: they must stay reachable by swipe and wheel, while the
  // labels stay clipped sideways.
  it("scrolls vertically without a scrollbar and clips sideways while collapsed", () => {
    render(
      <SidebarProvider>
        <SidebarContent data-testid="content" />
      </SidebarProvider>,
    );
    const classes = classesOf(screen.getByTestId("content"));
    expect(classes).not.toContain(
      "group-data-[collapsible=icon]:overflow-hidden",
    );
    expect(classes).toContain(
      "group-data-[collapsible=icon]:overflow-x-hidden",
    );
    expect(classes).toContain("group-data-[collapsible=icon]:overflow-y-auto");
    expect(classes).toContain(
      "group-data-[collapsible=icon]:[scrollbar-width:none]",
    );
  });
});

describe("sidebar overlay", () => {
  function renderOverlay() {
    return render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <SidebarProvider open={false} overlay>
          <SidebarTrigger />
          <Sidebar collapsible="icon">
            <SidebarMenuButton tooltip="Messages">Messages</SidebarMenuButton>
          </Sidebar>
        </SidebarProvider>
      </IntlProvider>,
    );
  }
  const openIt = () =>
    fireEvent.click(
      screen.getByRole("button", { name: en.shell.toggleSidebar }),
    );

  it("keeps the rail docked and opens the labelled sidebar over the page", () => {
    const { container } = renderOverlay();
    expect(screen.queryByRole("dialog")).toBeNull();
    const rail = container.querySelector('[data-slot="sidebar"]');
    expect(rail?.getAttribute("data-collapsible")).toBe("icon");

    openIt();
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Messages");
    expect(rail?.getAttribute("data-collapsible")).toBe("icon");
  });

  it("offers a close button that assistive tech can reach", () => {
    renderOverlay();
    openIt();
    const close = screen.getByRole("button", { name: en.common.close });
    expect(screen.getByRole("dialog").className).not.toContain(
      "[&>button]:hidden",
    );
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("focuses the first link when it opens", () => {
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <SidebarProvider open={false} overlay>
          <SidebarTrigger />
          <Sidebar collapsible="icon">
            <a href="/dashboard">Dashboard</a>
            <button type="button">Account</button>
          </Sidebar>
        </SidebarProvider>
      </IntlProvider>,
    );
    openIt();
    expect(document.activeElement?.textContent).toBe("Dashboard");
  });

  it("tells what's inside that it is in the sheet, and the docked sidebar that it is not", () => {
    function Probe() {
      return <span data-testid="probe">{String(useSidebar().inSheet)}</span>;
    }
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <SidebarProvider open={false} overlay>
          <SidebarTrigger />
          <Sidebar collapsible="icon">
            <Probe />
          </Sidebar>
        </SidebarProvider>
      </IntlProvider>,
    );
    openIt();
    const probes = screen.getAllByTestId("probe");
    const inDialog = probes.find((probe) =>
      screen.getByRole("dialog").contains(probe),
    );
    expect(inDialog?.textContent).toBe("true");
    expect(probes.find((probe) => probe !== inDialog)?.textContent).toBe(
      "false",
    );
  });

  // A row's rail tooltip would open on focus and take the first Escape, even hidden.
  it("has no rail tooltips inside, so one Escape closes it from a focused row", () => {
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <SidebarProvider open={false} overlay>
          <SidebarTrigger />
          <Sidebar collapsible="icon">
            <SidebarMenuButton asChild tooltip="Dashboard">
              <a href="/dashboard">Dashboard</a>
            </SidebarMenuButton>
          </Sidebar>
        </SidebarProvider>
      </IntlProvider>,
    );
    openIt();
    const row = document.activeElement as HTMLElement;
    expect(row.textContent).toBe("Dashboard");
    fireEvent.focus(row);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.keyDown(row, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

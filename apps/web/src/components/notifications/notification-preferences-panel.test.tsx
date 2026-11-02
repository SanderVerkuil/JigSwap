// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { NotificationPreferencesPanel } from "./notification-preferences-panel";

vi.mock("@/compat/clerk", () => ({ useUser: () => ({ user: { id: "u1" } }) }));
// Every query resolves at once: no stored preferences, and not an admin.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: {} }),
  useMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
}));
// The push section reads browser push APIs; its content plays no part in the layout.
vi.mock("./push-device-section", () => ({ PushDeviceSection: () => null }));

const CONTAINER = "@container/prefs";
const TWO_COLUMNS = "@4xl/prefs:grid-cols-[300px_minmax(0,1fr)]";

const elementsWithClass = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("[class]")].filter((element) =>
    element.classList.contains(name),
  );

afterEach(cleanup);

const renderPanel = () =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <NotificationPreferencesPanel />
    </IntlProvider>,
  );

describe("NotificationPreferencesPanel on touch", () => {
  const jumpNav = () =>
    screen.getByRole("navigation", { name: en.notifications.jumpTo });

  // A vertical list of 44px links pushed the settings off the first phone screen.
  it("wraps the jump links in a row on coarse pointers, and stacks them otherwise", () => {
    renderPanel();
    const classes = within(jumpNav()).getByRole("list").classList;
    expect(classes).toContain("flex-col");
    expect(classes).toContain("pointer-coarse:flex-row");
    expect(classes).toContain("pointer-coarse:flex-wrap");
  });

  it("makes each jump link a 44px pill that reads as tappable on coarse pointers", () => {
    renderPanel();
    const classes = within(jumpNav()).getAllByRole("link")[0].classList;
    expect(classes).toContain("pointer-coarse:min-h-11");
    expect(classes).toContain("pointer-coarse:rounded-full");
    expect(classes).toContain("pointer-coarse:border");
    expect(classes).toContain("pointer-coarse:text-foreground");
  });
});

describe("NotificationPreferencesPanel section heading", () => {
  it("says what the section holds, instead of repeating the page's h1", () => {
    renderPanel();
    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Per notification type",
    });
    expect(heading.textContent).not.toBe(en.notifications.preferences);
  });
});

describe("NotificationPreferencesPanel layout (UX-33)", () => {
  it("puts the query container above the two-column grid, never on it", () => {
    renderPanel();
    // A container query never styles its own container: on one element the
    // two columns never applied while the aside's sticky still did.
    const [container, ...extraContainers] = elementsWithClass(CONTAINER);
    const [grid, ...extraGrids] = elementsWithClass(TWO_COLUMNS);
    expect(extraContainers).toHaveLength(0);
    expect(extraGrids).toHaveLength(0);
    expect(container).toBeDefined();
    expect(grid).toBeDefined();
    expect(container).not.toBe(grid);
    expect(container.contains(grid)).toBe(true);
  });

  // A sticky whole aside (764px of it) ran off a laptop screen with most links out of reach.
  it("sticks only Jump to, in the two-column layout, below the sticky page head", () => {
    renderPanel();
    const nav = screen.getByRole("navigation", { name: "Jump to" });
    const aside = nav.closest("aside")!;
    const grid = elementsWithClass(TWO_COLUMNS)[0];
    expect(aside.parentElement).toBe(grid);
    expect(
      [...aside.classList].filter((name) => /sticky|self-start/.test(name)),
    ).toEqual([]);
    const classes = [...nav.classList];
    // Same container breakpoint as the two columns, and no unconditional sticky.
    expect(classes).toContain("@4xl/prefs:sticky");
    expect(classes).not.toContain("sticky");
    const top = classes.filter((name) => /(^|:)top-/.test(name));
    expect(top).toHaveLength(1);
    expect(top[0]).toMatch(/^@4xl\/prefs:top-\[calc\(var\(--app-sticky-top/);
  });
});

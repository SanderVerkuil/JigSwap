// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
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

describe("NotificationPreferencesPanel layout (UX-33)", () => {
  const renderPanel = () =>
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <NotificationPreferencesPanel />
      </IntlProvider>,
    );

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

  it("makes the aside sticky only in the two-column layout, below the sticky page head", () => {
    renderPanel();
    const aside = screen
      .getByRole("navigation", { name: "Jump to" })
      .closest("aside")!;
    const grid = elementsWithClass(TWO_COLUMNS)[0];
    expect(aside.parentElement).toBe(grid);
    const classes = [...aside.classList];
    // Same container breakpoint as the two columns, and no unconditional sticky.
    expect(classes).toContain("@4xl/prefs:sticky");
    expect(classes).not.toContain("sticky");
    const top = classes.filter((name) => /(^|:)top-/.test(name));
    expect(top).toHaveLength(1);
    expect(top[0]).toMatch(/^@4xl\/prefs:top-\[calc\(var\(--app-sticky-top/);
  });
});

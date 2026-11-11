// @vitest-environment happy-dom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useNavigate,
} from "@tanstack/react-router";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { LeaveGuard } from "./leave-guard";

afterEach(cleanup);

function setup({
  onDiscard = vi.fn(),
  save = new Promise<void>(() => {}),
}: { onDiscard?: () => void; save?: Promise<void> } = {}) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  function Form() {
    const [dirty, setDirty] = useState(false);
    const navigate = useNavigate();
    return (
      <>
        <button type="button" onClick={() => setDirty(true)}>
          type something
        </button>
        <button
          type="button"
          onClick={() => void save.then(() => setDirty(false))}
        >
          save
        </button>
        <button
          type="button"
          onClick={() => void navigate({ to: "/goals", ignoreBlocker: true })}
        >
          saved
        </button>
        <Link to="/goals">elsewhere</Link>
        <Link to="/my-puzzles">register</Link>
        <LeaveGuard
          work={dirty ? { kind: "addForm", count: 1 } : null}
          outlives={(pathname) => pathname === "/my-puzzles"}
          onDiscard={onDiscard}
        />
      </>
    );
  }
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/form",
        component: Form,
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/goals",
        component: () => <p>landed elsewhere</p>,
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/my-puzzles",
        component: () => <p>landed on register</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/form"] }),
  });
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <RouterProvider router={router} />
    </IntlProvider>,
  );
  return { router, onDiscard };
}

const leaveDialog = () =>
  screen.queryByRole("alertdialog", { name: "Leave without saving?" });
const dirty = async () =>
  fireEvent.click(
    await screen.findByRole("button", { name: "type something" }),
  );

describe("LeaveGuard", () => {
  it("leaves at once with nothing unsaved", async () => {
    setup();
    fireEvent.click(await screen.findByRole("link", { name: "elsewhere" }));
    await screen.findByText("landed elsewhere");
  });

  it("asks before dropping the work, and Keep editing stays", async () => {
    const { router, onDiscard } = setup();
    await dirty();
    fireEvent.click(screen.getByRole("link", { name: "elsewhere" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(leaveDialog()?.textContent).toContain(
      "The puzzle you filled in hasn't been added yet.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(leaveDialog()).toBeNull());
    expect(router.state.location.pathname).toBe("/form");
    expect(onDiscard).not.toHaveBeenCalled();
  });

  // A save on its way when the member tapped out may land while the dialog asks. Then there is
  // nothing left to lose: the question closes as Keep editing would, so the page shows what the
  // save led to, and the next tap leads on.
  it("closes once a save lands while it asks, and stays", async () => {
    let landSave!: () => void;
    const { router, onDiscard } = setup({
      save: new Promise((resolve) => (landSave = resolve)),
    });
    await dirty();
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    fireEvent.click(screen.getByRole("link", { name: "elsewhere" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();

    await act(async () => landSave());
    await waitFor(() => expect(leaveDialog()).toBeNull());
    expect(router.state.location.pathname).toBe("/form");
    expect(onDiscard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("link", { name: "elsewhere" }));
    await screen.findByText("landed elsewhere");
  });

  it("Discard drops the work and goes where the member was heading", async () => {
    const { onDiscard } = setup();
    await dirty();
    fireEvent.click(screen.getByRole("link", { name: "elsewhere" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await screen.findByText("landed elsewhere");
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it("never asks on the way to a page the work survives", async () => {
    setup();
    await dirty();
    fireEvent.click(screen.getByRole("link", { name: "register" }));
    await screen.findByText("landed on register");
    expect(leaveDialog()).toBeNull();
  });

  it("never asks when the page leaves after saving", async () => {
    setup();
    await dirty();
    fireEvent.click(screen.getByRole("button", { name: "saved" }));
    await screen.findByText("landed elsewhere");
    expect(leaveDialog()).toBeNull();
  });
});

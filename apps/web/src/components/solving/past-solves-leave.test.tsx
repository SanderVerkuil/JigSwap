// @vitest-environment happy-dom
import {
  createStepCommitStore,
  StepCommitContext,
} from "@/components/quick-start/step-commit";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import { PastSolvesList } from "./past-solves-form";

// Leaving /completions/past with ticks waiting: the same question as the other forms, so a batch
// of up to 25 rows and their dates isn't lost to one stray link. Runs on a real router, because
// what's under test is the navigation being held.
afterEach(cleanup);

const CANDIDATES = [
  { copyId: "a", title: "Mountain Lake" },
  { copyId: "b", title: "Cats" },
];

function setup({ inFlow = false }: { inFlow?: boolean } = {}) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const list = (
    <PastSolvesList
      candidates={CANDIDATES}
      pending={false}
      onSubmit={async () => true}
    />
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/past",
        component: () => (
          <>
            <Link to="/goals">elsewhere</Link>
            {inFlow ? (
              <StepCommitContext value={createStepCommitStore()}>
                {list}
              </StepCommitContext>
            ) : (
              list
            )}
          </>
        ),
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/goals",
        component: () => <p>landed elsewhere</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/past"] }),
  });
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <RouterProvider router={router} />
    </IntlProvider>,
  );
  return router;
}

const tick = async (title: string) =>
  fireEvent.click(
    await screen.findByRole("checkbox", { name: `I finished ${title}` }),
  );
const leave = () =>
  fireEvent.click(screen.getByRole("link", { name: "elsewhere" }));
const dialog = () =>
  screen.queryByRole("alertdialog", { name: "Leave without saving?" });

describe("PastSolvesList when leaving", () => {
  it("leaves at once with nothing ticked", async () => {
    setup();
    fireEvent.click(await screen.findByRole("link", { name: "elsewhere" }));
    await screen.findByText("landed elsewhere");
  });

  it("asks before dropping the ticks, naming how many, and Keep editing keeps them", async () => {
    const router = setup();
    await tick("Mountain Lake");
    await tick("Cats");
    leave();
    expect((await screen.findByRole("alertdialog")).textContent).toContain(
      "The 2 puzzles you ticked haven't been logged yet.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(router.state.location.pathname).toBe("/past");
    expect(screen.getByRole("button", { name: "Log 2 puzzles" })).toBeTruthy();
  });

  it("Discard goes where the member was heading", async () => {
    setup();
    await tick("Cats");
    leave();
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await screen.findByText("landed elsewhere");
  });

  it("doesn't ask once the batch is logged: the ticks are gone", async () => {
    setup();
    await tick("Cats");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Log 1 puzzle" }));
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Log / })).toBeNull(),
    );
    leave();
    await screen.findByText("landed elsewhere");
    expect(dialog()).toBeNull();
  });

  it("inside quick setup leaves the asking to the flow's own guard", async () => {
    setup({ inFlow: true });
    await tick("Cats");
    leave();
    await screen.findByText("landed elsewhere");
    expect(dialog()).toBeNull();
  });
});

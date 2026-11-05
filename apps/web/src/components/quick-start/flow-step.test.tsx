// @vitest-environment happy-dom
import type { QuickStartView } from "@jigswap/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useNavigate,
  useRouterState,
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
import { QuickStartFlowStep } from "./flow-step";
import { parseFlowStep } from "./logic";
import { useStepCommitRegistration } from "./step-commit";

afterEach(cleanup);

const VIEW: QuickStartView = {
  eligible: true,
  showWelcome: false,
  cardVisible: true,
  steps: [
    { id: "puzzles", status: "todo", optional: false },
    { id: "solves", status: "todo", optional: false },
    { id: "people", status: "todo", optional: false },
    { id: "household", status: "todo", optional: true },
    { id: "profile", status: "todo", optional: false },
  ],
  requiredDone: 0,
  requiredTotal: 4,
};

// Stands in for the picker: "pick" adds unsaved work; the commit is the test's.
function FakePicker({ save }: { save: () => Promise<boolean> }) {
  const [picks, setPicks] = useState(0);
  useStepCommitRegistration({
    kind: "puzzles",
    count: picks,
    ready: true,
    commit: async () => {
      const saved = await save();
      if (saved) setPicks(0);
      return saved;
    },
  });
  return (
    <button type="button" onClick={() => setPicks((n) => n + 1)}>
      pick
    </button>
  );
}

// A two-route app around the real QuickStartFlowStep: /welcome?step=… and /dashboard. Memory
// history only consults blockers on push/replace, so Back is checked in the browser instead.
function setup({
  save = async () => true,
}: { save?: () => Promise<boolean> } = {}) {
  const onSkip = vi.fn();
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const welcomeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/welcome",
    component: Welcome,
  });
  // Reads ?step= from the raw search: this test router is not the app's registered one, so its
  // typed search hooks don't apply.
  function Welcome() {
    const step =
      useRouterState({
        select: (state) =>
          parseFlowStep(
            new URLSearchParams(state.location.searchStr).get("step"),
          ),
      }) ?? "puzzles";
    const navigate = useNavigate();
    if (step === "done") return <p>done panel</p>;
    return (
      <QuickStartFlowStep
        key={step}
        step={step}
        view={VIEW}
        onSkip={onSkip}
        onNext={() =>
          void navigate({ to: "/welcome", search: { step: "solves" } })
        }
        renderBody={() => <FakePicker save={save} />}
      />
    );
  }
  const dashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/dashboard",
    component: () => <p>dashboard</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([welcomeRoute, dashboardRoute]),
    history: createMemoryHistory({ initialEntries: ["/welcome?step=puzzles"] }),
  });
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <RouterProvider router={router} />
    </IntlProvider>,
  );
  return { router, onSkip };
}

const pick = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "pick" }));
};
const continueButton = () => screen.getByRole("button", { name: /continue$/ });
// The phone header and the desktop stepper each render a Finish later link.
const finishLater = async () =>
  (await screen.findAllByRole("link", { name: "Finish later" }))[0]!;
const leaveDialog = () =>
  screen.queryByRole("alertdialog", { name: "Leave without saving?" });
const href = (router: ReturnType<typeof setup>["router"]) =>
  router.state.location.href;

describe("QuickStartFlowStep", () => {
  it("saves the picks on Continue and moves on without asking", async () => {
    const save = vi.fn(async () => true);
    const { router } = setup({ save });
    await pick();
    await pick();
    expect(continueButton().textContent).toBe("Add 2 and continue");

    fireEvent.click(continueButton());
    await waitFor(() => expect(href(router)).toBe("/welcome?step=solves"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(leaveDialog()).toBeNull();
  });

  it("saves once on a double tap", async () => {
    let finish!: (saved: boolean) => void;
    const save = vi.fn(
      () => new Promise<boolean>((resolve) => (finish = resolve)),
    );
    const { router } = setup({ save });
    await pick();
    fireEvent.click(continueButton());
    fireEvent.click(continueButton());
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => finish(true));
    await waitFor(() => expect(href(router)).toBe("/welcome?step=solves"));
  });

  it("stays on the step with the picks when saving fails", async () => {
    const { router } = setup({ save: async () => false });
    await pick();
    fireEvent.click(continueButton());
    await waitFor(() =>
      expect((continueButton() as HTMLButtonElement).disabled).toBe(false),
    );
    expect(href(router)).toBe("/welcome?step=puzzles");
    expect(continueButton().textContent).toBe("Add 1 and continue");
    expect(leaveDialog()).toBeNull();
  });

  it("leaves at once when nothing is pending", async () => {
    const { router } = setup();
    fireEvent.click(await finishLater());
    await screen.findByText("dashboard");
    expect(href(router)).toBe("/dashboard");
  });

  it("asks before Finish later drops the picks; Keep editing keeps them", async () => {
    const { router } = setup();
    await pick();
    fireEvent.click(await finishLater());
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(leaveDialog()?.textContent).toContain(
      "The puzzle you picked hasn't been added to your shelf yet.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(leaveDialog()).toBeNull());
    expect(href(router)).toBe("/welcome?step=puzzles");
    expect(continueButton().textContent).toBe("Add 1 and continue");
  });

  it("asks before a stepper link, and Escape keeps editing", async () => {
    const { router } = setup();
    await pick();
    // The desktop stepper links every other step.
    fireEvent.click(screen.getByRole("link", { name: "Find your people" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(leaveDialog()).toBeNull());
    expect(href(router)).toBe("/welcome?step=puzzles");
    expect(continueButton().textContent).toBe("Add 1 and continue");
  });

  it("goes where the member was heading after Discard", async () => {
    const { router } = setup();
    await pick();
    fireEvent.click(await finishLater());
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await screen.findByText("dashboard");
    expect(href(router)).toBe("/dashboard");
  });

  it("stores Skip only after Discard", async () => {
    const { onSkip } = setup();
    await pick();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(leaveDialog()).toBeNull());
    expect(onSkip).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("skips straight away when nothing is pending", async () => {
    const { onSkip } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(leaveDialog()).toBeNull();
  });
});

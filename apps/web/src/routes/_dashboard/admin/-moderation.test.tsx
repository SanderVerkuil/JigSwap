// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
//
// The console's route wiring against a live queue: what the dialogs and the selection act on when
// rows arrive and leave while the reviewer works. The components have their own tests; these pin
// what only the route decides. Convex is faked by a small store: each query subscribes to it, so a
// change re-renders the page the way a reactive query update does.
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
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
  within,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { Route as ModerationRoute } from "./moderation";

type Mutate = (args: Record<string, unknown>) => Promise<unknown>;

const convex = vi.hoisted(() => {
  let queries: Record<string, unknown> = {};
  const listeners = new Set<() => void>();
  return {
    mutations: {} as Record<string, Mutate>,
    snapshot: () => queries,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next: Record<string, unknown>) => {
      queries = { ...queries, ...next };
      listeners.forEach((listener) => listener());
    },
    reset: () => {
      queries = {};
    },
  };
});

// Every function reference is just its "module.name", which is what the fake store is keyed by.
vi.mock("@/gateway", () => {
  const moduleOf = (name: string) =>
    new Proxy({}, { get: (_, fn) => `${name}.${String(fn)}` });
  return {
    gateway: new Proxy({}, { get: (_, name) => moduleOf(String(name)) }),
  };
});
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (fn: string) => ({ fn }),
  useConvexMutation:
    (fn: string): Mutate =>
    (args) =>
      convex.mutations[fn]?.(args) ?? Promise.resolve(null),
}));
vi.mock("@tanstack/react-query", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useQuery: ({ fn }: { fn: string }) => ({
      data: useSyncExternalStore(convex.subscribe, convex.snapshot)[fn],
      isError: false,
      isFetching: false,
      refetch: () => {},
    }),
    useMutation: ({ mutationFn }: { mutationFn: Mutate }) => ({
      mutateAsync: mutationFn,
      isPending: false,
    }),
  };
});
vi.mock("sonner", () => ({
  toast: { success: () => {}, error: () => {} },
}));
// Out of scope here, and each runs its own queries.
vi.mock("@/components/admin/moderation/kpi-row", () => ({
  KpiRow: () => null,
}));
vi.mock("@/components/admin/moderation/screening-health", () => ({
  ScreeningHealth: () => null,
}));

const PENDING = "catalog.pending";
const APPROVE = "catalog.approve";
const REJECT = "catalog.reject";
const UPDATE = "catalog.updatePuzzle";

const submission = (id: string, title: string) => ({
  _id: id,
  aggregateId: `agg-${id}`,
  title,
  pieceCount: 1000,
  difficulty: "medium",
  tags: [],
  createdAt: 0,
});
const ALPINE = submission("a", "Alpine Lake");
const BUSY = submission("b", "Busy Harbour");
const NEWEST = submission("n", "Newest Arrival");

// Mirrors the file route's place in the tree, the way routeTree.gen attaches it.
function makeRouter(url = "/admin/moderation") {
  const rootRoute = createRootRoute({
    component: () => (
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Outlet />
      </IntlProvider>
    ),
  });
  const dashboard = createRoute({
    getParentRoute: () => rootRoute,
    id: "_dashboard",
    component: Outlet,
  });
  const moderation = ModerationRoute.update({
    id: "/admin/moderation",
    path: "/admin/moderation",
    getParentRoute: () => dashboard,
  } as never);
  return createRouter({
    routeTree: rootRoute.addChildren([dashboard.addChildren([moderation])]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
}

async function openConsole(url?: string) {
  const router = makeRouter(url);
  render(<RouterProvider router={router} />);
  await screen.findByRole("listbox", { name: "Submissions" });
  return router;
}

// The URL's item moves to Busy Harbour under the open dialog (Back, or a notification's link).
const selectBusyInUrl = async (router: ReturnType<typeof makeRouter>) => {
  await act(() =>
    router.navigate({
      to: "/admin/moderation",
      search: { item: "b" },
      replace: true,
    } as never),
  );
  // Behind the open modal, so hidden from the accessibility tree.
  await screen.findByRole("heading", {
    level: 3,
    name: "Busy Harbour",
    hidden: true,
  });
};

const heading = (title: string) =>
  screen.findByRole("heading", { level: 3, name: title });

async function openEditDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Edit & Approve" }));
  return screen.findByRole("dialog", { name: /edit/i });
}

async function openRejectDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Reject" }));
  return screen.findByRole("dialog", { name: "Reject this submission?" });
}

const saveEdit = (dialog: HTMLElement) =>
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Save & Approve" }),
  );

function confirmReject(dialog: HTMLElement) {
  fireEvent.click(
    within(dialog).getByRole("radio", { name: "Not a jigsaw puzzle" }),
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Reject submission" }),
  );
}

// A mutation whose result arrives when the test says so. Convex delivers the query update that
// removes the row before the mutation's promise resolves, so the tests can look at that moment.
function deferred() {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<unknown>((res, rej) => {
    resolve = () => res(null);
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width"),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  convex.reset();
  convex.mutations = {};
  convex.set({ [PENDING]: [ALPINE, BUSY] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("moderation console: Edit & Approve", () => {
  it("saves the submission it was opened for when a new row lands on top", async () => {
    const update = vi.fn<Mutate>(() => Promise.resolve(null));
    const approve = vi.fn<Mutate>(() => Promise.resolve(null));
    convex.mutations = { [UPDATE]: update, [APPROVE]: approve };
    await openConsole();
    await heading("Alpine Lake");
    const dialog = await openEditDialog();

    act(() => convex.set({ [PENDING]: [NEWEST, ALPINE, BUSY] }));
    saveEdit(dialog);

    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      puzzleDefinitionId: "agg-a",
      title: "Alpine Lake",
    });
    expect(approve.mock.calls[0]?.[0]).toEqual({
      puzzleDefinitionId: "agg-a",
      edited: true,
    });
  });

  it("saves the submission it was opened for when the selection moves on", async () => {
    const update = vi.fn<Mutate>(() => Promise.resolve(null));
    const approve = vi.fn<Mutate>(() => Promise.resolve(null));
    convex.mutations = { [UPDATE]: update, [APPROVE]: approve };
    const router = await openConsole();
    await heading("Alpine Lake");
    const dialog = await openEditDialog();

    await selectBusyInUrl(router);
    saveEdit(dialog);

    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      puzzleDefinitionId: "agg-a",
      title: "Alpine Lake",
    });
    expect(approve.mock.calls[0]?.[0]).toEqual({
      puzzleDefinitionId: "agg-a",
      edited: true,
    });
  });

  it("says so when someone else decides the submission meanwhile", async () => {
    await openConsole();
    await heading("Alpine Lake");
    const dialog = await openEditDialog();

    act(() => convex.set({ [PENDING]: [BUSY] }));

    expect(within(dialog).getByRole("alert").textContent).toBe(
      en.admin.moderation.editDialog.handledElsewhere,
    );
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", {
        name: "Save & Approve",
      }).disabled,
    ).toBe(true);
  });

  it("says so when the save fails because someone else got there first", async () => {
    const approving = deferred();
    convex.mutations = { [APPROVE]: () => approving.promise };
    await openConsole();
    await heading("Alpine Lake");
    const dialog = await openEditDialog();

    saveEdit(dialog);
    await waitFor(() => expect(within(dialog).queryByRole("alert")).toBeNull());
    act(() => convex.set({ [PENDING]: [BUSY] }));
    await act(async () => approving.reject(new Error("NotPending")));

    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toBe(
        en.admin.moderation.editDialog.handledElsewhere,
      ),
    );
  });
});

describe("moderation console: Reject", () => {
  it("rejects the submission it was opened for when a new row lands on top", async () => {
    const reject = vi.fn<Mutate>(() => Promise.resolve(null));
    convex.mutations = { [REJECT]: reject };
    await openConsole();
    await heading("Alpine Lake");
    const dialog = await openRejectDialog();

    act(() => convex.set({ [PENDING]: [NEWEST, ALPINE, BUSY] }));
    confirmReject(dialog);

    await waitFor(() => expect(reject).toHaveBeenCalledTimes(1));
    expect(reject.mock.calls[0]?.[0]).toEqual({
      puzzleDefinitionId: "agg-a",
      reason: "Not a jigsaw puzzle",
    });
  });

  it("rejects the submission it was opened for when the selection moves on", async () => {
    const reject = vi.fn<Mutate>(() => Promise.resolve(null));
    convex.mutations = { [REJECT]: reject };
    const router = await openConsole();
    await heading("Alpine Lake");
    const dialog = await openRejectDialog();

    await selectBusyInUrl(router);
    confirmReject(dialog);

    await waitFor(() => expect(reject).toHaveBeenCalledTimes(1));
    expect(reject.mock.calls[0]?.[0]).toEqual({
      puzzleDefinitionId: "agg-a",
      reason: "Not a jigsaw puzzle",
    });
  });

  it("says so when someone else decides the submission meanwhile", async () => {
    await openConsole();
    await heading("Alpine Lake");
    const dialog = await openRejectDialog();

    act(() => convex.set({ [PENDING]: [BUSY] }));

    expect(within(dialog).getByRole("alert").textContent).toBe(
      en.admin.moderation.rejectDialog.handledElsewhere,
    );
  });
});

describe("moderation console: the selection", () => {
  it("moves to the neighbour after the reviewer's decision, and the URL follows", async () => {
    const approve = vi.fn<Mutate>(() => {
      convex.set({ [PENDING]: [BUSY] });
      return Promise.resolve(null);
    });
    convex.mutations = { [APPROVE]: approve };
    const router = await openConsole();
    await heading("Alpine Lake");

    fireEvent.click(screen.getByRole("button", { name: "Approve & Publish" }));

    await heading("Busy Harbour");
    expect(approve.mock.calls[0]?.[0]).toEqual({ puzzleDefinitionId: "agg-a" });
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ item: "b" }),
    );
    expect(screen.queryByText(en.admin.moderation.handledElsewhere.title)).toBe(
      null,
    );
  });

  it("stays on a row someone else decides, with its actions off", async () => {
    await openConsole();
    await heading("Alpine Lake");

    act(() => convex.set({ [PENDING]: [BUSY] }));

    await screen.findByText(en.admin.moderation.handledElsewhere.title);
    await heading("Alpine Lake");
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Approve & Publish",
      }).disabled,
    ).toBe(true);
  });
});

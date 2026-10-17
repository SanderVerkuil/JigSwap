import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANCHOR_TIMEOUT_MS,
  dockSide,
  resolveStartIndex,
  SAME_PAGE_GRACE_MS,
  tourButtonState,
  TourController,
  tourKeyAction,
  tourNextLabel,
  waitFor,
  type TourProgressWrite,
} from "./controller";
import type { TourDefinition } from "./definitions";

const TOUR: TourDefinition = {
  id: "demo",
  steps: [
    { id: "a", route: "/one", target: "one-a" },
    { id: "b", route: "/one", target: "one-b" },
    { id: "c", route: "/two", target: "two-c" },
    { id: "d", route: "/two" },
  ],
};

// A fake "page": the current path plus the anchors mounted on it. Anchors are plain strings here;
// the real provider uses elements.
function setup(path = "/start") {
  const world = {
    path,
    anchors: new Set<string>(),
    // Anchors whose element carries `data-tour-action`.
    actions: new Set<string>(),
    // The router commits navigation later in reality; tests can hold it back.
    commitNavigation: true,
  };
  const record = vi.fn<(write: TourProgressWrite) => void>();
  const navigate = vi.fn((route: string) => {
    if (world.commitNavigation) world.path = route;
  });
  const onEnd = vi.fn();
  const controller = new TourController<string>({
    tours: new Map([[TOUR.id, TOUR]]),
    currentPath: () => world.path,
    navigate,
    findTarget: (anchor) => (world.anchors.has(anchor) ? anchor : null),
    isActionTarget: (target) => world.actions.has(target),
  });
  controller.connect({ record, onEnd });
  return { world, record, navigate, onEnd, controller };
}

const running = (controller: TourController<string>) => {
  const s = controller.getSnapshot();
  if (s.status !== "running") throw new Error("tour is not running");
  return s;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("waitFor", () => {
  it("resolves true as soon as the check passes, polling", async () => {
    let ready = false;
    const done = vi.fn();
    void waitFor(() => ready, { timeoutMs: 1000 }).then(done);
    await vi.advanceTimersByTimeAsync(300);
    expect(done).not.toHaveBeenCalled();
    ready = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toHaveBeenCalledWith(true);
  });

  it("resolves false after the timeout", async () => {
    const done = vi.fn();
    void waitFor(() => false, { timeoutMs: 500 }).then(done);
    await vi.advanceTimersByTimeAsync(499);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledWith(false);
  });

  it("stops when cancelled", async () => {
    let cancelled = false;
    const done = vi.fn();
    void waitFor(() => false, {
      timeoutMs: 5000,
      cancelled: () => cancelled,
    }).then(done);
    cancelled = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toHaveBeenCalledWith(false);
  });
});

describe("TourController: step resolution", () => {
  it("shows a same-page step at once when its anchor is mounted", () => {
    const { world, controller, navigate } = setup("/one");
    world.anchors.add("one-a");
    controller.start("demo");
    expect(navigate).not.toHaveBeenCalled();
    expect(running(controller)).toMatchObject({
      index: 0,
      total: 4,
      phase: "shown",
      target: "one-a",
      crossRoute: false,
    });
  });

  it("navigates to a step on another page, pends, then shows once the anchor mounts", async () => {
    const { world, controller, navigate } = setup("/start");
    controller.start("demo");
    expect(navigate).toHaveBeenCalledWith("/one");
    expect(running(controller)).toMatchObject({
      phase: "pending",
      crossRoute: true,
      target: null,
    });
    await vi.advanceTimersByTimeAsync(1000);
    world.anchors.add("one-a");
    await vi.advanceTimersByTimeAsync(100);
    expect(running(controller)).toMatchObject({
      phase: "shown",
      target: "one-a",
    });
  });

  it("does not accept an anchor still mounted on the previous page before the route changes", async () => {
    const { world, controller } = setup("/one");
    world.anchors.add("one-a");
    world.anchors.add("two-c"); // e.g. a shell anchor present on every page
    controller.start("demo", 1);
    world.anchors.add("one-b");
    world.commitNavigation = false; // the router has not committed /two yet
    controller.next(); // to "c" on /two
    await vi.advanceTimersByTimeAsync(200);
    expect(running(controller).phase).toBe("pending");
    world.path = "/two";
    await vi.advanceTimersByTimeAsync(100);
    expect(running(controller)).toMatchObject({ phase: "shown", index: 2 });
  });

  it("falls back to the centred card when a cross-page anchor never appears (3 s)", async () => {
    const { controller } = setup("/start");
    controller.start("demo");
    await vi.advanceTimersByTimeAsync(ANCHOR_TIMEOUT_MS - 100);
    expect(running(controller).phase).toBe("pending");
    await vi.advanceTimersByTimeAsync(100);
    expect(running(controller)).toMatchObject({
      phase: "missing",
      target: null,
    });
  });

  it("gives a missing same-page anchor only a short grace period", async () => {
    const { world, controller } = setup("/one");
    world.anchors.add("one-a");
    controller.start("demo");
    controller.next(); // "b" is not mounted (e.g. admin-only)
    expect(running(controller).phase).toBe("pending");
    await vi.advanceTimersByTimeAsync(SAME_PAGE_GRACE_MS);
    expect(running(controller)).toMatchObject({ index: 1, phase: "missing" });
  });

  it("shows a step without a target as the centred card once its page is open", async () => {
    const { world, controller } = setup("/two");
    world.anchors.add("two-c");
    controller.start("demo", 3);
    expect(running(controller)).toMatchObject({ index: 3, phase: "missing" });

    const other = setup("/start");
    other.controller.start("demo", 3);
    expect(running(other.controller).phase).toBe("pending");
    await vi.advanceTimersByTimeAsync(0);
    expect(running(other.controller).phase).toBe("missing");
  });

  it("ignores a stale anchor wait after the member moved on", async () => {
    const { world, controller } = setup("/one");
    world.anchors.add("one-a");
    controller.start("demo");
    controller.next(); // pending on "b"
    controller.back(); // "a" shows at once
    expect(running(controller)).toMatchObject({ index: 0, phase: "shown" });
    world.anchors.add("one-b");
    await vi.advanceTimersByTimeAsync(SAME_PAGE_GRACE_MS);
    expect(running(controller)).toMatchObject({ index: 0, phase: "shown" });
  });

  it("ignores unknown tours", () => {
    const { controller, record } = setup();
    controller.start("nope");
    expect(controller.getSnapshot()).toEqual({ status: "idle" });
    expect(record).not.toHaveBeenCalled();
  });

  it("notifies subscribers on every change", () => {
    const { world, controller } = setup("/one");
    world.anchors.add("one-a");
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.start("demo");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    controller.pause();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("TourController: progress, resume and restart", () => {
  it("saves every step it enters, and completion after the last", async () => {
    const { world, controller, record, onEnd } = setup("/one");
    world.anchors.add("one-a");
    world.anchors.add("one-b");
    controller.start("demo");
    controller.next();
    controller.next(); // navigates to /two
    controller.next(); // "d"
    controller.next(); // done
    expect(record.mock.calls.map(([write]) => write)).toEqual([
      { tourId: "demo", status: "in_progress", step: 0 },
      { tourId: "demo", status: "in_progress", step: 1 },
      { tourId: "demo", status: "in_progress", step: 2 },
      { tourId: "demo", status: "in_progress", step: 3 },
      { tourId: "demo", status: "completed" },
    ]);
    expect(onEnd).toHaveBeenCalledWith({
      tourId: "demo",
      index: 3,
      reason: "completed",
    });
    expect(controller.getSnapshot()).toEqual({ status: "idle" });
  });

  it("pauses without another write: the current step is already saved", () => {
    const { world, controller, record, onEnd } = setup("/one");
    world.anchors.add("one-a");
    world.anchors.add("one-b");
    controller.start("demo");
    controller.next();
    record.mockClear();
    controller.pause();
    expect(record).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith({
      tourId: "demo",
      index: 1,
      reason: "paused",
    });
    controller.pause(); // idempotent
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("resumes at the saved step and restarts at the first", () => {
    expect(
      resolveStartIndex(
        { tourId: "demo", status: "in_progress", step: 2, updatedAt: 1 },
        4,
      ),
    ).toBe(2);
    // A tour that shrank since the step was saved resumes at its last step.
    expect(
      resolveStartIndex(
        { tourId: "demo", status: "in_progress", step: 9, updatedAt: 1 },
        4,
      ),
    ).toBe(3);
    expect(
      resolveStartIndex(
        { tourId: "demo", status: "completed", updatedAt: 1 },
        4,
      ),
    ).toBe(0);
    expect(resolveStartIndex(undefined, 4)).toBe(0);

    const { world, controller, record } = setup("/one");
    world.anchors.add("one-b");
    controller.start("demo", 1);
    expect(running(controller).index).toBe(1);
    expect(record).toHaveBeenLastCalledWith({
      tourId: "demo",
      status: "in_progress",
      step: 1,
    });
    controller.start("demo", 99);
    expect(running(controller).index).toBe(3);
  });

  it("labels the entry button take / resume (1-based) / replay", () => {
    expect(tourButtonState(undefined, 3)).toEqual({ kind: "take" });
    expect(
      tourButtonState({ tourId: "t", status: "dismissed", updatedAt: 1 }, 3),
    ).toEqual({ kind: "take" });
    expect(
      tourButtonState(
        { tourId: "t", status: "in_progress", step: 1, updatedAt: 1 },
        3,
      ),
    ).toEqual({ kind: "resume", step: 2, total: 3 });
    expect(
      tourButtonState({ tourId: "t", status: "completed", updatedAt: 1 }, 3),
    ).toEqual({ kind: "replay" });
  });
});

describe("keyboard", () => {
  it("maps arrows and Esc, ignoring Back on the first step", () => {
    expect(tourKeyAction("ArrowRight", { isFirstStep: true })).toBe("next");
    expect(tourKeyAction("ArrowLeft", { isFirstStep: true })).toBeNull();
    expect(tourKeyAction("ArrowLeft", { isFirstStep: false })).toBe("back");
    expect(tourKeyAction("Escape", { isFirstStep: false })).toBe("pause");
    expect(tourKeyAction("Enter", { isFirstStep: false })).toBeNull();
  });

  it("drives the controller from keys", () => {
    const { world, controller, onEnd } = setup("/one");
    world.anchors.add("one-a");
    world.anchors.add("one-b");
    controller.start("demo");
    expect(controller.handleKey("ArrowLeft")).toBe(false);
    expect(controller.handleKey("ArrowRight")).toBe(true);
    expect(running(controller).index).toBe(1);
    expect(controller.handleKey("ArrowLeft")).toBe(true);
    expect(running(controller).index).toBe(0);
    expect(controller.handleKey("x")).toBe(false);
    expect(controller.handleKey("Escape")).toBe(true);
    expect(onEnd).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "paused" }),
    );
    expect(controller.handleKey("ArrowRight")).toBe(false);
  });
});

describe("TourController: action steps", () => {
  const actionSetup = () => {
    const ctx = setup("/one");
    ctx.world.anchors.add("one-a");
    ctx.world.actions.add("one-a");
    return ctx;
  };

  it("flags a lit action target and ignores ArrowRight", () => {
    const { controller } = actionSetup();
    controller.start("demo");
    expect(running(controller)).toMatchObject({
      index: 0,
      phase: "shown",
      action: true,
    });
    expect(controller.handleKey("ArrowRight")).toBe(false);
    expect(running(controller).index).toBe(0);
    expect(controller.handleKey("Escape")).toBe(true);
    expect(controller.getSnapshot()).toEqual({ status: "idle" });
  });

  it("moves on by itself once the target leaves the page", async () => {
    const { world, controller } = actionSetup();
    controller.start("demo");
    await vi.advanceTimersByTimeAsync(1000);
    expect(running(controller).index).toBe(0);
    // The member pressed it: the page re-renders without the button, with the next anchor.
    world.anchors.delete("one-a");
    world.anchors.add("one-b");
    await vi.advanceTimersByTimeAsync(100);
    expect(running(controller)).toMatchObject({
      index: 1,
      phase: "shown",
      action: false,
    });
  });

  it("completes the tour when the last step's action is done", async () => {
    const { world, record, onEnd } = setup("/two");
    world.anchors.add("two-c");
    world.actions.add("two-c");
    const tour: TourDefinition = {
      id: "demo",
      steps: [{ id: "c", route: "/two", target: "two-c" }],
    };
    const solo = new TourController<string>({
      tours: new Map([[tour.id, tour]]),
      currentPath: () => world.path,
      navigate: () => {},
      findTarget: (anchor) => (world.anchors.has(anchor) ? anchor : null),
      isActionTarget: (target) => world.actions.has(target),
    });
    solo.connect({ record, onEnd });
    solo.start("demo");
    expect(running(solo).action).toBe(true);
    world.anchors.delete("two-c");
    await vi.advanceTimersByTimeAsync(100);
    expect(solo.getSnapshot()).toEqual({ status: "idle" });
    expect(record).toHaveBeenLastCalledWith({
      tourId: "demo",
      status: "completed",
    });
    expect(onEnd).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "completed" }),
    );
  });

  it("stops watching after the member pauses or goes back", async () => {
    const { world, controller, onEnd } = actionSetup();
    controller.start("demo");
    controller.pause();
    world.anchors.delete("one-a");
    await vi.advanceTimersByTimeAsync(500);
    expect(controller.getSnapshot()).toEqual({ status: "idle" });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("lets Back return from the step after an action", async () => {
    const { world, controller } = actionSetup();
    controller.start("demo");
    world.anchors.delete("one-a");
    world.anchors.add("one-b");
    await vi.advanceTimersByTimeAsync(100);
    expect(running(controller).index).toBe(1);
    // The first anchor now resolves to the new (non-action) content.
    world.anchors.add("one-a");
    world.actions.delete("one-a");
    controller.back();
    expect(running(controller)).toMatchObject({
      index: 0,
      phase: "shown",
      action: false,
    });
    expect(controller.handleKey("ArrowRight")).toBe(true);
    expect(running(controller).index).toBe(1);
  });

  it("returns to the action step when a resumed step's anchor needs that action", async () => {
    const { controller } = actionSetup();
    // Resumed at step 2, but its anchor only appears after step 1's action.
    controller.start("demo", 1);
    await vi.advanceTimersByTimeAsync(SAME_PAGE_GRACE_MS + 100);
    expect(running(controller)).toMatchObject({
      index: 0,
      phase: "shown",
      action: true,
    });
  });

  it("walks back past steps whose anchors also depend on that action", async () => {
    const { world } = actionSetup();
    const tour: TourDefinition = {
      id: "deep",
      steps: [
        { id: "a", route: "/one", target: "one-a" },
        { id: "b", route: "/one", target: "one-b" },
        { id: "c", route: "/one", target: "one-c" },
      ],
    };
    const deep = new TourController<string>({
      tours: new Map([[tour.id, tour]]),
      currentPath: () => world.path,
      navigate: () => {},
      findTarget: (anchor) => (world.anchors.has(anchor) ? anchor : null),
      isActionTarget: (target) => world.actions.has(target),
    });
    // Resumed at the last step; only the first step's action target is on the page.
    deep.start("deep", 2);
    await vi.advanceTimersByTimeAsync(SAME_PAGE_GRACE_MS + 100);
    expect(running(deep)).toMatchObject({ index: 0, action: true });
  });

  it("keeps a missing card when the previous step is not an action", async () => {
    const { world, controller } = setup("/one");
    world.anchors.add("one-a");
    controller.start("demo", 1);
    await vi.advanceTimersByTimeAsync(SAME_PAGE_GRACE_MS + 100);
    expect(running(controller)).toMatchObject({ index: 1, phase: "missing" });
  });

  it("leaves normal steps untouched", () => {
    const { world, controller } = setup("/one");
    world.anchors.add("one-a");
    world.anchors.add("one-b");
    controller.start("demo");
    expect(running(controller).action).toBe(false);
    expect(controller.handleKey("ArrowRight")).toBe(true);
    expect(running(controller).index).toBe(1);
  });
});

describe("tourNextLabel", () => {
  it("says Next on the same page, Next: <page> across pages, Done at the end", () => {
    const { world, controller } = setup("/one");
    world.anchors.add("one-a");
    world.anchors.add("one-b");
    controller.start("demo");
    expect(tourNextLabel(running(controller))).toEqual({ kind: "next" });
    controller.next();
    expect(tourNextLabel(running(controller))).toEqual({
      kind: "nextOnPage",
      route: "/two",
    });
    controller.start("demo", 3);
    expect(tourNextLabel(running(controller))).toEqual({ kind: "done" });
  });
});

describe("dockSide", () => {
  it("docks to the top when the target sits in the bottom 45%", () => {
    expect(dockSide({ top: 100, bottom: 140 }, 800)).toBe("bottom");
    expect(dockSide({ top: 740, bottom: 790 }, 800)).toBe("top");
    expect(dockSide({ top: 420, bottom: 440 }, 800)).toBe("bottom");
    expect(dockSide({ top: 440, bottom: 480 }, 800)).toBe("top");
  });
});

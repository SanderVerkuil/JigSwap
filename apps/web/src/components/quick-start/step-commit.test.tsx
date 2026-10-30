// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createContinueRunner,
  createLeaveGuard,
  createStepCommitStore,
  hasPendingWork,
  StepCommitContext,
  useStepCommitRegistration,
  useStepCommitSnapshot,
  type StepCommitKind,
  type StepCommitStore,
} from "./step-commit";

afterEach(cleanup);

describe("createStepCommitStore", () => {
  it("starts empty and notifies only when the snapshot changes", () => {
    const store = createStepCommitStore();
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.getSnapshot()).toBeNull();

    store.publish({ kind: "puzzles", count: 2, ready: true });
    const first = store.getSnapshot();
    expect(first).toEqual({ kind: "puzzles", count: 2, ready: true });
    expect(listener).toHaveBeenCalledTimes(1);

    // Same content: no notification, and the snapshot keeps its identity (useSyncExternalStore
    // would otherwise re-render forever).
    store.publish({ kind: "puzzles", count: 2, ready: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(first);

    store.publish({ kind: "puzzles", count: 3, ready: true });
    store.publish(null);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot()).toBeNull();
  });

  it("stops notifying an unsubscribed listener", () => {
    const store = createStepCommitStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.publish({ kind: "solves", count: 1, ready: true });
    expect(listener).not.toHaveBeenCalled();
  });

  it("commits with the latest registered function, and saves nothing when none is set", async () => {
    const store = createStepCommitStore();
    await expect(store.commit()).resolves.toBe(true);
    const older = vi.fn(async () => false);
    const latest = vi.fn(async () => true);
    store.setCommit(older);
    store.setCommit(latest);
    await expect(store.commit()).resolves.toBe(true);
    expect(older).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });
});

describe("hasPendingWork", () => {
  it("is true only for a snapshot with something to save", () => {
    expect(hasPendingWork(null)).toBe(false);
    expect(hasPendingWork({ kind: "solves", count: 0, ready: true })).toBe(
      false,
    );
    expect(hasPendingWork({ kind: "solves", count: 1, ready: false })).toBe(
      true,
    );
  });
});

describe("createLeaveGuard", () => {
  const setup = () => {
    const store = createStepCommitStore();
    const runner = createContinueRunner(() => {});
    return { store, runner, guard: createLeaveGuard(store, runner) };
  };

  it("asks before leaving a step with unsaved work, never with nothing pending", () => {
    const { store, guard } = setup();
    expect(guard.shouldAsk()).toBe(false);
    store.publish({ kind: "solves", count: 0, ready: true });
    expect(guard.shouldAsk()).toBe(false);
    store.publish({ kind: "solves", count: 2, ready: false });
    expect(guard.shouldAsk()).toBe(true);
  });

  it("never asks once the member moves on on purpose", () => {
    const { store, guard } = setup();
    store.publish({ kind: "puzzles", count: 2, ready: true });
    guard.leave();
    expect(guard.shouldAsk()).toBe(false);
  });

  it("never asks while Continue is saving the work", async () => {
    const { store, runner, guard } = setup();
    store.publish({ kind: "puzzles", count: 2, ready: true });
    let finish!: (saved: boolean) => void;
    const saving = runner.run({
      commit: () => new Promise<boolean>((resolve) => (finish = resolve)),
      go: () => {},
    });
    expect(guard.shouldAsk()).toBe(false);
    finish(false);
    await saving;
    // The save failed: the work is still unsaved, so the guard is back.
    expect(guard.shouldAsk()).toBe(true);
  });
});

// A step that registers its pending work, as the picker, the past-solves list and the profile
// step do inside /welcome.
function FakeStep({
  kind = "puzzles",
  onCommit,
}: {
  kind?: StepCommitKind;
  onCommit: (count: number) => Promise<boolean>;
}) {
  const [count, setCount] = useState(0);
  const inFlow = useStepCommitRegistration({
    kind,
    count,
    ready: true,
    commit: () => onCommit(count),
  });
  return (
    <div>
      <p data-testid="in-flow">{String(inFlow)}</p>
      <button type="button" onClick={() => setCount((n) => n + 1)}>
        pick
      </button>
    </div>
  );
}

function Host({
  store,
  show = true,
  onCommit,
}: {
  store: StepCommitStore;
  show?: boolean;
  onCommit: (count: number) => Promise<boolean>;
}) {
  const snapshot = useStepCommitSnapshot(store);
  return (
    <>
      <p data-testid="footer">
        {snapshot ? `${snapshot.kind}:${snapshot.count}` : "none"}
      </p>
      <StepCommitContext value={store}>
        {show && <FakeStep onCommit={onCommit} />}
      </StepCommitContext>
    </>
  );
}

describe("useStepCommitRegistration", () => {
  it("publishes the step's pending count to the flow and commits the latest state", async () => {
    const store = createStepCommitStore();
    const onCommit = vi.fn(async () => true);
    const view = render(<Host store={store} onCommit={onCommit} />);
    expect(view.getByTestId("footer").textContent).toBe("puzzles:0");
    expect(view.getByTestId("in-flow").textContent).toBe("true");

    act(() => view.getByText("pick").click());
    act(() => view.getByText("pick").click());
    expect(view.getByTestId("footer").textContent).toBe("puzzles:2");

    await act(async () => {
      await store.commit();
    });
    // Called with the state of the last render, never a stale closure.
    expect(onCommit).toHaveBeenCalledWith(2);
  });

  it("clears the snapshot and the commit when the step unmounts", async () => {
    const store = createStepCommitStore();
    const onCommit = vi.fn(async () => true);
    const view = render(<Host store={store} onCommit={onCommit} />);
    act(() => view.getByText("pick").click());
    view.rerender(<Host store={store} show={false} onCommit={onCommit} />);
    expect(view.getByTestId("footer").textContent).toBe("none");
    await act(async () => {
      await expect(store.commit()).resolves.toBe(true);
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does nothing outside the quick setup flow", () => {
    const view = render(<FakeStep onCommit={async () => true} />);
    expect(view.getByTestId("in-flow").textContent).toBe("false");
  });
});

describe("createContinueRunner", () => {
  const deferred = () => {
    let resolve!: (saved: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("goes on at once when there is nothing to save", async () => {
    const busy = vi.fn();
    const go = vi.fn();
    const runner = createContinueRunner(busy);
    await expect(runner.run({ commit: null, go })).resolves.toBe("went");
    expect(go).toHaveBeenCalledTimes(1);
    expect(busy).not.toHaveBeenCalled();
  });

  it("saves first, goes on only after it saved, and ignores a second tap meanwhile", async () => {
    const busy = vi.fn();
    const go = vi.fn();
    const save = deferred();
    const commit = vi.fn(() => save.promise);
    const runner = createContinueRunner(busy);

    const first = runner.run({ commit, go });
    expect(runner.isBusy()).toBe(true);
    expect(busy).toHaveBeenLastCalledWith(true);
    await expect(runner.run({ commit, go })).resolves.toBe("ignored");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(go).not.toHaveBeenCalled();

    save.resolve(true);
    await expect(first).resolves.toBe("went");
    expect(go).toHaveBeenCalledTimes(1);
    expect(runner.isBusy()).toBe(false);
    expect(busy).toHaveBeenLastCalledWith(false);
  });

  it("stays on the step when saving fails, and lets the member try again", async () => {
    const go = vi.fn();
    const runner = createContinueRunner(() => {});
    await expect(runner.run({ commit: async () => false, go })).resolves.toBe(
      "stayed",
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      runner.run({
        commit: async () => {
          throw new Error("offline");
        },
        go,
      }),
    ).resolves.toBe("stayed");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    expect(go).not.toHaveBeenCalled();
    expect(runner.isBusy()).toBe(false);
    await expect(runner.run({ commit: async () => true, go })).resolves.toBe(
      "went",
    );
    expect(go).toHaveBeenCalledTimes(1);
  });
});

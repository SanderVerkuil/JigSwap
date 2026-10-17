import type { QuickStartStepView, QuickStartView } from "@jigswap/contracts";
import { describe, expect, it } from "vitest";
import {
  cardMode,
  displayCount,
  inviteExtrasSuppressed,
  isTextEntry,
  nextFlowStep,
  parseFlowStep,
  progressSegments,
  resolveFlowStep,
  rowState,
  shouldOfferPush,
  stepPosition,
  welcomeSurfaceBusy,
} from "./logic";

const step = (
  id: QuickStartStepView["id"],
  status: QuickStartStepView["status"] = "todo",
  extra: Partial<QuickStartStepView> = {},
): QuickStartStepView => ({
  id,
  status,
  optional: id === "household",
  ...extra,
});

const view = (overrides: Partial<QuickStartView> = {}): QuickStartView => ({
  eligible: true,
  showWelcome: true,
  cardVisible: true,
  steps: [
    step("puzzles"),
    step("solves"),
    step("people"),
    step("household"),
    step("profile"),
  ],
  requiredDone: 0,
  requiredTotal: 4,
  ...overrides,
});

const withSteps = (
  statuses: Record<string, QuickStartStepView["status"]>,
): QuickStartView =>
  view({
    steps: view().steps.map((s) => ({
      ...s,
      status: statuses[s.id] ?? s.status,
    })),
  });

describe("parseFlowStep (validateSearch)", () => {
  it("accepts the five steps and done", () => {
    for (const id of [
      "puzzles",
      "solves",
      "people",
      "household",
      "profile",
      "done",
    ]) {
      expect(parseFlowStep(id)).toBe(id);
    }
  });

  it("drops anything else", () => {
    expect(parseFlowStep(undefined)).toBeUndefined();
    expect(parseFlowStep("")).toBeUndefined();
    expect(parseFlowStep("PUZZLES")).toBeUndefined();
    expect(parseFlowStep(3)).toBeUndefined();
    expect(parseFlowStep("toString")).toBeUndefined();
  });
});

describe("resolveFlowStep", () => {
  it("keeps a requested step, even one that is done", () => {
    expect(resolveFlowStep("people", withSteps({ people: "done" }))).toBe(
      "people",
    );
  });

  it("waits for the view when no step was requested", () => {
    expect(resolveFlowStep(undefined, undefined)).toBeUndefined();
  });

  it("opens the first required step that is neither done nor skipped", () => {
    expect(resolveFlowStep(undefined, view())).toBe("puzzles");
    expect(
      resolveFlowStep(
        undefined,
        withSteps({ puzzles: "done", solves: "skipped" }),
      ),
    ).toBe("people");
  });

  it("never resolves to the optional household step", () => {
    expect(
      resolveFlowStep(
        undefined,
        withSteps({ puzzles: "done", solves: "done", people: "done" }),
      ),
    ).toBe("profile");
  });

  it("resolves to done when every required step is closed", () => {
    expect(
      resolveFlowStep(
        undefined,
        withSteps({
          puzzles: "done",
          solves: "skipped",
          people: "done",
          profile: "skipped",
        }),
      ),
    ).toBe("done");
  });
});

describe("nextFlowStep", () => {
  it("walks puzzles → solves → people → household → profile → done", () => {
    expect(nextFlowStep("puzzles")).toBe("solves");
    expect(nextFlowStep("solves")).toBe("people");
    expect(nextFlowStep("people")).toBe("household");
    expect(nextFlowStep("household")).toBe("profile");
    expect(nextFlowStep("profile")).toBe("done");
    expect(nextFlowStep("done")).toBe("done");
  });
});

describe("stepPosition (stepper eyebrow)", () => {
  it("numbers the four required steps and marks household optional", () => {
    expect(stepPosition("puzzles")).toEqual({ kind: "required", index: 1 });
    expect(stepPosition("solves")).toEqual({ kind: "required", index: 2 });
    expect(stepPosition("people")).toEqual({ kind: "required", index: 3 });
    expect(stepPosition("household")).toEqual({ kind: "optional" });
    expect(stepPosition("profile")).toEqual({ kind: "required", index: 4 });
  });
});

describe("progressSegments", () => {
  it("has one segment per required step, filled only when done", () => {
    expect(
      progressSegments(
        withSteps({
          puzzles: "done",
          solves: "skipped",
          household: "done",
          profile: "done",
        }).steps,
      ),
    ).toEqual([true, false, false, true]);
  });

  it("is four empty segments for a fresh member", () => {
    expect(progressSegments(view().steps)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("rowState", () => {
  it("passes done and skipped through", () => {
    expect(rowState(step("solves", "done"))).toBe("done");
    expect(rowState(step("solves", "skipped"))).toBe("skipped");
  });

  it("is in progress for a partial puzzle count (1 or 2 of 3)", () => {
    expect(rowState(step("puzzles", "todo", { count: 2 }))).toBe("inProgress");
    expect(rowState(step("puzzles", "todo", { count: 0 }))).toBe("todo");
    expect(rowState(step("puzzles", "todo"))).toBe("todo");
  });

  it("treats counts on other steps as plain todo", () => {
    // people counts follows; a todo people step has none, so nothing is partial.
    expect(rowState(step("people", "todo", { count: 0 }))).toBe("todo");
  });
});

describe("displayCount", () => {
  it("shows the 51 cap as 50+", () => {
    expect(displayCount(51)).toBe("50+");
    expect(displayCount(50)).toBe("50");
    expect(displayCount(undefined)).toBe("0");
  });
});

describe("welcomeSurfaceBusy (priority over the What's new highlight)", () => {
  it("is busy while the member is still loading", () => {
    expect(
      welcomeSurfaceBusy({
        memberLoading: true,
        hasMember: false,
        view: undefined,
      }),
    ).toBe(true);
  });

  it("is busy while the onboarding query is still loading", () => {
    expect(
      welcomeSurfaceBusy({
        memberLoading: false,
        hasMember: true,
        view: undefined,
      }),
    ).toBe(true);
  });

  it("is busy while the welcome is due", () => {
    expect(
      welcomeSurfaceBusy({
        memberLoading: false,
        hasMember: true,
        view: view(),
      }),
    ).toBe(true);
  });

  it("frees the highlight once the welcome is not due", () => {
    expect(
      welcomeSurfaceBusy({
        memberLoading: false,
        hasMember: true,
        view: view({ showWelcome: false }),
      }),
    ).toBe(false);
  });

  it("never blocks when there is no member row to load for", () => {
    expect(
      welcomeSurfaceBusy({
        memberLoading: false,
        hasMember: false,
        view: undefined,
      }),
    ).toBe(false);
  });
});

describe("inviteExtrasSuppressed (D7)", () => {
  it("is unknown while loading, so the redeemer waits", () => {
    expect(inviteExtrasSuppressed(undefined)).toBeUndefined();
  });

  it("suppresses while eligible and the card is showing", () => {
    expect(inviteExtrasSuppressed(view())).toBe(true);
  });

  it("does not suppress once the member is past the window", () => {
    expect(inviteExtrasSuppressed(view({ eligible: false }))).toBe(false);
  });

  it("does not suppress when the card was hidden", () => {
    expect(inviteExtrasSuppressed(view({ cardVisible: false }))).toBe(false);
  });
});

describe("cardMode", () => {
  const allClosed = view({
    cardVisible: false,
    steps: withSteps({
      puzzles: "done",
      solves: "skipped",
      people: "done",
      profile: "done",
    }).steps,
  });

  it("renders nothing while loading", () => {
    expect(
      cardMode({
        view: undefined,
        usedThisSession: true,
        hiddenThisSession: false,
      }),
    ).toBe("hidden");
  });

  it("is active while the server says the card is visible", () => {
    expect(
      cardMode({
        view: view(),
        usedThisSession: false,
        hiddenThisSession: false,
      }),
    ).toBe("active");
  });

  it("collapses to the all-done row in the session the quick start was used", () => {
    expect(
      cardMode({
        view: allClosed,
        usedThisSession: true,
        hiddenThisSession: false,
      }),
    ).toBe("allDone");
  });

  it("is gone on a later session", () => {
    expect(
      cardMode({
        view: allClosed,
        usedThisSession: false,
        hiddenThisSession: false,
      }),
    ).toBe("hidden");
  });

  it("is gone once hidden", () => {
    expect(
      cardMode({
        view: allClosed,
        usedThisSession: true,
        hiddenThisSession: true,
      }),
    ).toBe("hidden");
    expect(
      cardMode({
        view: view(),
        usedThisSession: true,
        hiddenThisSession: true,
      }),
    ).toBe("hidden");
  });

  it("stays hidden when the card is dismissed with steps still open", () => {
    expect(
      cardMode({
        view: view({ cardVisible: false }),
        usedThisSession: true,
        hiddenThisSession: false,
      }),
    ).toBe("hidden");
  });
});

describe("shouldOfferPush (§2.7)", () => {
  const ready = {
    triggered: true,
    supported: true,
    permission: "default" as const,
    configured: true,
    asked: false,
  };

  it("offers after the first social action on a capable, unasked device", () => {
    expect(shouldOfferPush(ready)).toBe(true);
  });

  it("never offers before a follow, share or copy", () => {
    expect(shouldOfferPush({ ...ready, triggered: false })).toBe(false);
  });

  it("needs push support, a default permission and a VAPID key", () => {
    expect(shouldOfferPush({ ...ready, supported: false })).toBe(false);
    expect(shouldOfferPush({ ...ready, permission: "granted" })).toBe(false);
    expect(shouldOfferPush({ ...ready, permission: "denied" })).toBe(false);
    expect(shouldOfferPush({ ...ready, permission: null })).toBe(false);
    expect(shouldOfferPush({ ...ready, configured: false })).toBe(false);
  });

  it("asks once per device", () => {
    expect(shouldOfferPush({ ...ready, asked: true })).toBe(false);
  });
});

describe("isTextEntry (B11: hide the mobile footer while typing)", () => {
  it("is true for text inputs and textareas", () => {
    expect(isTextEntry({ tagName: "INPUT", type: "search" })).toBe(true);
    expect(isTextEntry({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTextEntry({ tagName: "TEXTAREA" })).toBe(true);
  });

  it("is false for controls that raise no keyboard", () => {
    expect(isTextEntry({ tagName: "BUTTON", type: "button" })).toBe(false);
    expect(isTextEntry({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isTextEntry({ tagName: "INPUT", type: "date" })).toBe(false);
    expect(isTextEntry({ tagName: "SELECT" })).toBe(false);
    expect(isTextEntry({ tagName: "A" })).toBe(false);
  });
});

// @vitest-environment happy-dom
import { formatDateOnly } from "@/lib/date-input";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import type { GoalRow } from "./goal-row";
import { GoalSections } from "./goal-sections";
import type { GoalTileActions } from "./goal-tile";

// The goals page sorts goals into Active, Achieved and a collapsible Past goals (ended or
// archived), hides empty sections, and gives every goal the mutations can address a menu.

const NOW = new Date(2026, 9, 30, 12);

let seq = 0;
const goal = (over: Partial<GoalRow> = {}): GoalRow => {
  seq += 1;
  return {
    _id: `row-${seq}` as GoalRow["_id"],
    _creationTime: Date.UTC(2026, 0, 1),
    aggregateId: `goal-${seq}`,
    userId: "user-1" as GoalRow["userId"],
    title: `Goal ${seq}`,
    targetCompletions: 10,
    currentCompletions: 4,
    startDate: Date.UTC(2026, 0, 1),
    targetDate: Date.UTC(2026, 11, 31),
    isActive: true,
    isAchieved: false,
    createdAt: Date.UTC(2026, 0, 1),
    updatedAt: Date.UTC(2026, 0, 1),
    ...over,
  };
};

const actionsLog: string[] = [];
const actionsFor = (g: GoalRow): GoalTileActions | undefined =>
  g.aggregateId === undefined
    ? undefined
    : {
        onEdit: () => actionsLog.push(`edit:${g.title}`),
        onArchive: () => actionsLog.push(`archive:${g.title}`),
        onRestore: () => actionsLog.push(`restore:${g.title}`),
        onDelete: () => actionsLog.push(`delete:${g.title}`),
      };

const renderSections = (goals: GoalRow[], locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <GoalSections goals={goals} actionsFor={actionsFor} now={NOW} />
    </IntlProvider>,
  );

const headings = () =>
  screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

afterEach(() => {
  cleanup();
  actionsLog.length = 0;
});

describe("GoalSections", () => {
  it("shows no Active heading when every goal is achieved", () => {
    renderSections([
      goal({ title: "Done", currentCompletions: 10, isAchieved: true }),
    ]);
    expect(headings()).toEqual(["Achieved"]);
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("keeps past goals folded away behind a labelled toggle while there are live ones", () => {
    renderSections([
      goal({ title: "Chasing" }),
      goal({ title: "Last year", targetDate: Date.UTC(2025, 11, 31) }),
      goal({ title: "Shelved", isActive: false }),
    ]);
    expect(headings()).toEqual(["Active", "Past goals"]);
    expect(screen.getByText("2 goals")).toBeDefined();
    expect(screen.queryByText("Last year")).toBeNull();

    const toggle = screen.getByRole("button", { name: "Show past goals" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(
      screen
        .getByRole("button", { name: "Hide past goals" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText("Last year")).toBeDefined();
    expect(screen.getByText("Shelved")).toBeDefined();
  });

  it("opens past goals when they are all the member has, with neutral Ended and Archived badges", () => {
    renderSections([
      goal({ title: "Last year", targetDate: Date.UTC(2025, 11, 31) }),
      goal({ title: "Shelved", isActive: false }),
    ]);
    expect(headings()).toEqual(["Past goals"]);
    expect(screen.getByText("Ended")).toBeDefined();
    expect(screen.getByText("Archived")).toBeDefined();
    expect(screen.queryByText("Achieved")).toBeNull();
  });

  it("opens past goals when archiving leaves nothing else on the page", () => {
    const tree = (goals: GoalRow[]) => (
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <GoalSections goals={goals} actionsFor={actionsFor} now={NOW} />
      </IntlProvider>
    );
    const last = goal({ title: "The only one" });
    const { rerender } = render(tree([last]));
    rerender(tree([{ ...last, isActive: false }]));
    expect(screen.getByText("The only one")).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "Hide past goals" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("keeps past goals the way the member left them", () => {
    const tree = (goals: GoalRow[]) => (
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <GoalSections goals={goals} actionsFor={actionsFor} now={NOW} />
      </IntlProvider>
    );
    const live = goal({ title: "Chasing" });
    const shelved = goal({ title: "Shelved", isActive: false });
    const { rerender } = render(tree([live, shelved]));
    fireEvent.click(screen.getByRole("button", { name: "Show past goals" }));
    rerender(tree([live, shelved, goal({ title: "New one" })]));
    expect(screen.getByText("Shelved")).toBeDefined();

    // Closed by hand: archiving the rest doesn't reopen it.
    fireEvent.click(screen.getByRole("button", { name: "Hide past goals" }));
    rerender(tree([{ ...live, isActive: false }, shelved]));
    expect(screen.queryByText("Shelved")).toBeNull();
  });

  it("files an achieved goal under Achieved even after its end date", () => {
    renderSections([
      goal({
        title: "Made it",
        isAchieved: true,
        currentCompletions: 10,
        targetDate: Date.UTC(2025, 11, 31),
      }),
    ]);
    expect(headings()).toEqual(["Achieved"]);
  });

  it("shows the period the goal counts in, as calendar dates", () => {
    renderSections([
      goal({ title: "This year" }),
      goal({
        title: "Open",
        startDate: undefined,
        targetDate: undefined,
        createdAt: Date.UTC(2026, 2, 3, 23, 30),
      }),
    ]);
    expect(
      screen.getByText(
        `${formatDateOnly(Date.UTC(2026, 0, 1))} – ${formatDateOnly(Date.UTC(2026, 11, 31))}`,
      ),
    ).toBeDefined();
    // Without a start date it counts from the (UTC) day it was created, like the server.
    expect(
      screen.getByText(`From ${formatDateOnly(Date.UTC(2026, 2, 3))}`),
    ).toBeDefined();
  });
});

describe("GoalTile menu", () => {
  const openMenu = (name: string) => {
    const trigger = screen.getByRole("button", { name });
    fireEvent.keyDown(trigger, { key: "Enter" });
    return screen.getByRole("menu");
  };

  it("offers Edit, Archive and Delete on a live goal", () => {
    renderSections([goal({ title: "Ten" })]);
    const menu = openMenu("Actions for Ten");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Edit", "Archive", "Delete"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    expect(actionsLog).toEqual(["delete:Ten"]);
  });

  it("offers Restore instead of Archive on an archived goal", () => {
    renderSections([goal({ title: "Shelved", isActive: false })]);
    const menu = openMenu("Actions for Shelved");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Edit", "Restore", "Delete"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Restore" }));
    expect(actionsLog).toEqual(["restore:Shelved"]);
  });

  it("shows no menu for a goal the goal mutations can't address", () => {
    renderSections([goal({ title: "Legacy", aggregateId: undefined })]);
    expect(screen.getByText("Legacy")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Actions for/ })).toBeNull();
  });

  it("is translated (nl)", () => {
    renderSections([goal({ title: "Tien" })], "nl");
    expect(headings()).toEqual(["Actief"]);
    const menu = openMenu("Acties voor Tien");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Bewerken", "Archiveren", "Verwijderen"]);
  });
});

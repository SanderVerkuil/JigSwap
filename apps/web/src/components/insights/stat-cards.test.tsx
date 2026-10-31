// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { StatCards, type PersonalStats } from "./stat-cards";

const base: PersonalStats = {
  completionsCount: 4,
  totalSolveMinutes: 200,
  averageSolveMinutes: 50,
  puzzlesOwned: 3,
  distinctDefinitions: 3,
  collectionsCount: 1,
  exchangesCompleted: 0,
  averageRatingGiven: null,
  averageRatingReceived: 0,
  goalsAchieved: 0,
  goalsTotal: 0,
};

const renderStats = (
  stats: Partial<PersonalStats> = {},
  locale: "en" | "nl" = "en",
) =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <StatCards stats={{ ...base, ...stats }} />
    </IntlProvider>,
  );

// The cell a stat label sits in: value first, then the label, then the optional sub-line.
const cellOf = (label: string) => screen.getByText(label).parentElement;

afterEach(cleanup);

describe("StatCards", () => {
  it("lays the secondary figures out three to a row on phones", () => {
    const { container } = renderStats();
    const [headline, secondary] = Array.from(
      container.firstElementChild?.children ?? [],
    );
    expect(headline?.classList).toContain("grid-cols-2");
    expect(secondary?.classList).toContain("grid-cols-3");
  });

  it("says how many of all goals were achieved", () => {
    renderStats({ goalsAchieved: 2, goalsTotal: 5 });
    const goals = cellOf("Goals achieved");
    expect(goals?.firstElementChild?.textContent).toBe("2");
    expect(goals?.textContent).toContain("2 of 5 goals");
    expect(goals?.textContent).not.toContain("active");
  });

  it("counts a single goal in the singular, in Dutch too", () => {
    renderStats({ goalsAchieved: 1, goalsTotal: 1 }, "nl");
    expect(cellOf("Doelen behaald")?.textContent).toContain("1 van 1 doel");
  });

  it("leaves the goals sub-line out when there are no goals", () => {
    renderStats({ goalsAchieved: 0, goalsTotal: 0 });
    expect(cellOf("Goals achieved")?.textContent).toBe("0Goals achieved");
  });

  it("leaves the goals sub-line out when the server doesn't send a total yet", () => {
    renderStats({ goalsAchieved: 1, goalsTotal: undefined });
    expect(cellOf("Goals achieved")?.textContent).toBe("1Goals achieved");
  });

  it("leads with the solve figures once there is a finished solve", () => {
    renderStats({ completionsCount: 4 });
    expect(cellOf("Completions")?.firstElementChild?.textContent).toBe("4");
    expect(screen.getByText("Total solve time")).toBeDefined();
    expect(screen.getByText("Puzzles owned")).toBeDefined();
  });

  it("drops the zero solve figures while there is no finished solve", () => {
    renderStats({ completionsCount: 0, totalSolveMinutes: 0 });
    expect(screen.queryByText("Completions")).toBeNull();
    expect(screen.queryByText("Total solve time")).toBeNull();
    // What the member does have still shows.
    expect(cellOf("Puzzles owned")?.firstElementChild?.textContent).toBe("3");
    expect(screen.getByText("Exchanges completed")).toBeDefined();
    expect(screen.getByText("Collections")).toBeDefined();
  });
});

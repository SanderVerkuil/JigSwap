// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
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
  goalsActive: 0,
  goalsAchieved: 0,
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
});

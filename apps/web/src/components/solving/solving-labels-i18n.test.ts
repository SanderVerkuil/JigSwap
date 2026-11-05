import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";

// The completion log's Log button and the goals page's New goal button are quoted word for word by
// the track-your-solves tour, so a rename must reach the tour too. In Dutch the Log button also
// names the page it opens, and both buttons are in sentence case like the rest of the Dutch UI.
// (English casing waits for the vocabulary decision, UX-53.)

const catalogs = { en, nl, source } as const;

describe.each(Object.entries(catalogs))("%s solving buttons", (_, catalog) => {
  const steps = catalog.tours["track-your-solves"].steps;

  it("are quoted by the tour as they are labelled", () => {
    expect(steps["log-past"].body).toContain(
      catalog.solving.completions.logAction,
    );
    expect(steps.goals.body).toContain(catalog.solving.goals.create);
  });
});

describe("Dutch solving buttons", () => {
  it("name the page the Log button opens", () => {
    expect(nl.solving.completions.logAction).toBe(
      nl.solving.completions.new.title,
    );
  });

  it("are in sentence case", () => {
    for (const label of [
      nl.solving.completions.logAction,
      nl.solving.goals.create,
    ]) {
      const [, ...rest] = label.split(" ");
      expect(rest.every((word) => word === word.toLowerCase())).toBe(true);
    }
  });
});

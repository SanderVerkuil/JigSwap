import { describe, expect, it } from "vitest";
import {
  announcedCount,
  canOpenHighlight,
  formatWhatsNewCount,
  groupByMonth,
  isoDateUtc,
  knownUnreadIds,
  pickHighlightEntry,
} from "./logic";

const at = (iso: string) => Date.parse(iso);

describe("groupByMonth", () => {
  it("groups newest-first entries by UTC month, keeping their order", () => {
    const entries = [
      { id: "c", publishedAt: at("2026-10-14T00:00:00Z") },
      { id: "b", publishedAt: at("2026-10-01T00:00:00Z") },
      { id: "a", publishedAt: at("2026-09-30T23:30:00Z") },
    ];
    const groups = groupByMonth(entries);
    expect(groups.map((g) => g.key)).toEqual(["2026-10", "2026-09"]);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(["c", "b"]);
    expect(groups[1]!.entries.map((e) => e.id)).toEqual(["a"]);
    expect(groups[1]!.monthStart).toBe(at("2026-09-01T00:00:00Z"));
  });

  it("uses UTC, not the local clock, at a month boundary", () => {
    // 2026-11-01T00:30+01:00 is still October in UTC.
    const groups = groupByMonth([
      { id: "x", publishedAt: at("2026-10-31T23:30:00Z") },
    ]);
    expect(groups[0]!.key).toBe("2026-10");
  });

  it("returns no groups for no entries", () => {
    expect(groupByMonth([])).toEqual([]);
  });
});

describe("isoDateUtc", () => {
  it("formats the UTC calendar date", () => {
    expect(isoDateUtc(at("2026-10-14T00:00:00Z"))).toBe("2026-10-14");
    expect(isoDateUtc(at("2026-10-14T23:59:00Z"))).toBe("2026-10-14");
  });
});

describe("knownUnreadIds", () => {
  it("keeps only ids the bundle knows, in server order", () => {
    expect(knownUnreadIds(["c", "zzz", "a"], new Set(["a", "b", "c"]))).toEqual(
      ["c", "a"],
    );
  });
});

describe("pickHighlightEntry", () => {
  const entries = [
    { id: "new-plain", highlight: false },
    { id: "new-hl", highlight: true },
    { id: "old-hl", highlight: true },
  ];

  it("picks the newest unread highlighted entry", () => {
    expect(
      pickHighlightEntry(entries, ["new-plain", "new-hl", "old-hl"])?.id,
    ).toBe("new-hl");
  });

  it("skips highlighted entries that are already read", () => {
    expect(pickHighlightEntry(entries, ["new-plain", "old-hl"])?.id).toBe(
      "old-hl",
    );
  });

  it("returns undefined when no highlighted entry is unread", () => {
    expect(pickHighlightEntry(entries, ["new-plain"])).toBeUndefined();
    expect(pickHighlightEntry(entries, [])).toBeUndefined();
  });
});

describe("canOpenHighlight (priority rule)", () => {
  const idle = {
    pathname: "/dashboard",
    shownThisSession: false,
    hasCandidate: true,
    surfaceBusy: false,
    dialogOpen: false,
  };

  it("opens when nothing else is on screen", () => {
    expect(canOpenHighlight(idle)).toBe(true);
  });

  it("never opens twice in a session", () => {
    expect(canOpenHighlight({ ...idle, shownThisSession: true })).toBe(false);
  });

  it("needs a candidate", () => {
    expect(canOpenHighlight({ ...idle, hasCandidate: false })).toBe(false);
  });

  it("never opens on /whats-new (with or without a trailing slash)", () => {
    expect(canOpenHighlight({ ...idle, pathname: "/whats-new" })).toBe(false);
    expect(canOpenHighlight({ ...idle, pathname: "/whats-new/" })).toBe(false);
  });

  it("never opens over the quick start flow at /welcome", () => {
    expect(canOpenHighlight({ ...idle, pathname: "/welcome" })).toBe(false);
    expect(canOpenHighlight({ ...idle, pathname: "/welcome/" })).toBe(false);
  });

  it("defers to a task-flow prompt or a running tour", () => {
    expect(canOpenHighlight({ ...idle, surfaceBusy: true })).toBe(false);
  });

  it("defers to any open dialog or sheet", () => {
    expect(canOpenHighlight({ ...idle, dialogOpen: true })).toBe(false);
  });
});

describe("announcedCount", () => {
  it("does not announce the first loaded value", () => {
    expect(announcedCount(undefined, 3)).toBeNull();
  });

  it("announces the new total on an increase", () => {
    expect(announcedCount(0, 1)).toBe(1);
    expect(announcedCount(2, 3)).toBe(3);
  });

  it("does not announce a decrease, no change, or a reload", () => {
    expect(announcedCount(3, 0)).toBeNull();
    expect(announcedCount(2, 2)).toBeNull();
    expect(announcedCount(2, undefined)).toBeNull();
  });
});

describe("formatWhatsNewCount", () => {
  it("caps at 9+", () => {
    expect(formatWhatsNewCount(1)).toBe("1");
    expect(formatWhatsNewCount(9)).toBe("9");
    expect(formatWhatsNewCount(10)).toBe("9+");
  });
});

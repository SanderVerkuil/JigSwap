import { describe, expect, it } from "vitest";
import { toMemberId } from "../../shared-kernel";
import { ActivityEntry, buildActivityFeed } from "./activity-feed";
import { MemberId } from "./ids";

const member = (id: string): MemberId => toMemberId(id);

const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  memberId: member("alice"),
  kind: "completion",
  occurredAt: new Date("2026-06-08T10:00:00Z"),
  ref: "ref-1",
  ...over,
});

describe("buildActivityFeed", () => {
  it("returns an empty feed for empty input", () => {
    expect(buildActivityFeed([])).toEqual([]);
  });

  it("sorts entries newest-first", () => {
    const feed = buildActivityFeed([
      entry({ ref: "old", occurredAt: new Date("2026-01-01T00:00:00Z") }),
      entry({ ref: "new", occurredAt: new Date("2026-06-08T00:00:00Z") }),
      entry({ ref: "mid", occurredAt: new Date("2026-03-01T00:00:00Z") }),
    ]);
    expect(feed.map((e) => e.ref)).toEqual(["new", "mid", "old"]);
  });

  it("preserves input order among entries with equal timestamps (stable)", () => {
    const ts = new Date("2026-06-08T10:00:00Z");
    const feed = buildActivityFeed([
      entry({ ref: "first", occurredAt: ts }),
      entry({ ref: "second", occurredAt: ts }),
      entry({ ref: "third", occurredAt: ts }),
    ]);
    expect(feed.map((e) => e.ref)).toEqual(["first", "second", "third"]);
  });

  it("interleaves mixed kinds purely by recency", () => {
    const feed = buildActivityFeed([
      entry({
        kind: "acquisition",
        ref: "a",
        occurredAt: new Date("2026-02-01T00:00:00Z"),
      }),
      entry({
        kind: "exchange",
        ref: "x",
        occurredAt: new Date("2026-04-01T00:00:00Z"),
      }),
      entry({
        kind: "completion",
        ref: "c",
        occurredAt: new Date("2026-03-01T00:00:00Z"),
      }),
    ]);
    expect(feed.map((e) => [e.kind, e.ref])).toEqual([
      ["exchange", "x"],
      ["completion", "c"],
      ["acquisition", "a"],
    ]);
  });

  it("caps the feed to the limit, keeping the newest entries", () => {
    const feed = buildActivityFeed(
      [
        entry({ ref: "old", occurredAt: new Date("2026-01-01T00:00:00Z") }),
        entry({ ref: "new", occurredAt: new Date("2026-06-08T00:00:00Z") }),
        entry({ ref: "mid", occurredAt: new Date("2026-03-01T00:00:00Z") }),
      ],
      { limit: 2 },
    );
    expect(feed.map((e) => e.ref)).toEqual(["new", "mid"]);
  });

  it("returns the full feed when no limit is given", () => {
    const entries = [
      entry({ ref: "a" }),
      entry({ ref: "b", occurredAt: new Date("2026-05-01T00:00:00Z") }),
    ];
    expect(buildActivityFeed(entries)).toHaveLength(2);
  });

  it("does not mutate the input array", () => {
    const entries = [
      entry({ ref: "old", occurredAt: new Date("2026-01-01T00:00:00Z") }),
      entry({ ref: "new", occurredAt: new Date("2026-06-08T00:00:00Z") }),
    ];
    buildActivityFeed(entries);
    expect(entries.map((e) => e.ref)).toEqual(["old", "new"]);
  });
});

import type { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";
import { describe, expect, it } from "vitest";
import { groupSameDayAdds } from "./activity-feed-group";

type Entry = FunctionReturnType<typeof gateway.social.activityFeed>[number];

// 15 Jan 2026, 12:00 UTC (13:00 in Amsterdam, CET).
const NOON = Date.UTC(2026, 0, 15, 12);
const HOUR = 60 * 60 * 1000;

const add = (
  ref: string,
  occurredAt: number,
  overrides: Partial<Entry> = {},
): Entry => ({
  memberId: "sander1",
  kind: "acquisition",
  occurredAt,
  ref,
  actorName: "Sander",
  actor: { handle: "sander1" },
  target: { kind: "copy", id: `doc-${ref}` },
  subject: { title: `Puzzle ${ref}`, coverUrl: `https://example.com/${ref}` },
  ...overrides,
});

describe("groupSameDayAdds", () => {
  it("folds consecutive single adds by one member on one day into one batch row", () => {
    const rows = groupSameDayAdds(
      [add("a", NOON), add("b", NOON - HOUR), add("c", NOON - 2 * HOUR)],
      "Europe/Amsterdam",
    );
    expect(rows).toEqual([
      {
        memberId: "sander1",
        kind: "acquisitionBatch",
        occurredAt: NOON,
        ref: "day:a",
        actorName: "Sander",
        actor: { handle: "sander1" },
        target: { kind: "memberPuzzles", handle: "sander1" },
        batch: {
          count: 3,
          covers: [
            {
              copyId: "a",
              title: "Puzzle a",
              coverUrl: "https://example.com/a",
            },
            {
              copyId: "b",
              title: "Puzzle b",
              coverUrl: "https://example.com/b",
            },
            {
              copyId: "c",
              title: "Puzzle c",
              coverUrl: "https://example.com/c",
            },
          ],
        },
      },
    ]);
  });

  it("splits at midnight in the given time zone, not in UTC", () => {
    // 23:30 and 00:30 in Amsterdam: two days there, one day in UTC.
    const lateEvening = Date.UTC(2026, 0, 15, 22, 30);
    const afterMidnight = Date.UTC(2026, 0, 15, 23, 30);
    const entries = [add("a", afterMidnight), add("b", lateEvening)];

    expect(
      groupSameDayAdds(entries, "Europe/Amsterdam").map((e) => e.kind),
    ).toEqual(["acquisition", "acquisition"]);
    expect(groupSameDayAdds(entries, "UTC").map((e) => e.kind)).toEqual([
      "acquisitionBatch",
    ]);
  });

  it("keeps adds apart when another member or another kind comes between them", () => {
    const rows = groupSameDayAdds(
      [
        add("a", NOON),
        add("b", NOON - HOUR, {
          memberId: "hans1",
          actor: { handle: "hans1" },
        }),
        add("c", NOON - 2 * HOUR),
        { ...add("d", NOON - 3 * HOUR), kind: "completion" },
        add("e", NOON - 4 * HOUR),
      ],
      "Europe/Amsterdam",
    );
    expect(rows.map((e) => e.ref)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("leaves a lone add, server batches and other kinds untouched", () => {
    const lone = add("a", NOON);
    const batch: Entry = {
      memberId: "sander1",
      kind: "acquisitionBatch",
      occurredAt: NOON - HOUR,
      ref: "batch-1",
      batch: { count: 2, covers: [] },
    };
    const rows = groupSameDayAdds([lone, batch], "Europe/Amsterdam");
    expect(rows[0]).toBe(lone);
    expect(rows[1]).toBe(batch);
  });

  it("shows at most four covers and a placeholder for an add the server didn't name", () => {
    const entries = ["a", "b", "c", "d", "e"].map((ref, i) =>
      add(ref, NOON - i * HOUR, ref === "b" ? { subject: undefined } : {}),
    );
    const [row] = groupSameDayAdds(entries, "Europe/Amsterdam");
    expect(row?.batch?.count).toBe(5);
    expect(row?.batch?.covers.map((c) => c.copyId)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(row?.batch?.covers[1]).toEqual({
      copyId: "b",
      title: "",
      coverUrl: null,
    });
  });

  it("gives a departed member's folded adds no link", () => {
    const gone = {
      actor: undefined,
      actorName: undefined,
      actorDeparted: true as const,
    };
    const [row] = groupSameDayAdds(
      [add("a", NOON, gone), add("b", NOON - HOUR, gone)],
      "Europe/Amsterdam",
    );
    expect(row?.kind).toBe("acquisitionBatch");
    expect(row?.actorDeparted).toBe(true);
    expect(row?.actor).toBeUndefined();
    expect(row?.target).toBeUndefined();
  });
});

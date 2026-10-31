import { describe, expect, it } from "vitest";
import {
  summarizeDocFeedback,
  type DocFeedbackEntry,
} from "./doc-feedback-summary";

let seq = 0;
const vote = (
  slug: string,
  helpful: boolean,
  extra: Partial<DocFeedbackEntry> = {},
): DocFeedbackEntry => ({
  _id: `v${++seq}`,
  slug,
  helpful,
  createdAt: 1_000 + seq,
  ...extra,
});

describe("summarizeDocFeedback", () => {
  it("groups votes per page with helpful and not-helpful counts and the unhelpful share", () => {
    const [summary] = summarizeDocFeedback([
      vote("swaps", true),
      vote("swaps", false),
      vote("swaps", true),
      vote("swaps", true),
    ]);
    expect(summary).toMatchObject({
      slug: "swaps",
      helpful: 3,
      notHelpful: 1,
      unhelpfulShare: 0.25,
    });
  });

  it("puts the most not-helpful votes first, then the higher unhelpful share", () => {
    const summaries = summarizeDocFeedback([
      vote("a", false),
      vote("a", true),
      vote("b", false),
      vote("b", false),
      vote("b", true),
      vote("b", true),
      vote("b", true),
      vote("c", false),
      vote("d", true),
    ]);
    // b: 2 not helpful; a: 1 (50%); c: 1 (100%); d: 0.
    expect(summaries.map((s) => s.slug)).toEqual(["b", "c", "a", "d"]);
  });

  it("keeps a page's non-blank comments, newest first", () => {
    const [summary] = summarizeDocFeedback([
      vote("a", false, { comment: "older", createdAt: 1, locale: "nl" }),
      vote("a", false, { comment: "   ", createdAt: 2 }),
      vote("a", false, { comment: "newer", createdAt: 3 }),
      vote("a", true, { createdAt: 4 }),
    ]);
    expect(summary?.comments.map((c) => c.comment)).toEqual(["newer", "older"]);
    expect(summary?.comments[1]).toMatchObject({
      helpful: false,
      locale: "nl",
      createdAt: 1,
    });
  });

  it("returns nothing for no votes", () => {
    expect(summarizeDocFeedback([])).toEqual([]);
  });
});

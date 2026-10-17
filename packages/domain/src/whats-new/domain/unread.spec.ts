import { describe, expect, it } from "vitest";
import { unreadWhatsNewEntryIds } from "./unread";

const CREATED = Date.UTC(2026, 9, 10);
const before = { id: "before", publishedAt: Date.UTC(2026, 9, 1) };
const atCreation = { id: "at-creation", publishedAt: CREATED };
const after = { id: "after", publishedAt: Date.UTC(2026, 9, 15) };
const later = { id: "later", publishedAt: Date.UTC(2026, 9, 20) };

const unread = (
  entries: { id: string; publishedAt: number }[],
  seenIds: string[] = [],
) => unreadWhatsNewEntryIds(entries, { memberCreatedAt: CREATED, seenIds });

describe("unreadWhatsNewEntryIds", () => {
  it("is unread when published after the account was created and not seen", () => {
    expect(unread([after])).toEqual(["after"]);
  });

  it("is never unread when published before the account was created", () => {
    expect(unread([before])).toEqual([]);
  });

  it("is never unread when published at the moment the account was created", () => {
    expect(unread([atCreation])).toEqual([]);
  });

  it("is read once seen", () => {
    expect(unread([after], ["after"])).toEqual([]);
  });

  it("keeps only unread ids, in input order", () => {
    expect(unread([later, before, after, atCreation], ["after"])).toEqual([
      "later",
    ]);
    expect(unread([later, after])).toEqual(["later", "after"]);
  });

  it("is empty with no entries", () => {
    expect(unread([])).toEqual([]);
  });
});

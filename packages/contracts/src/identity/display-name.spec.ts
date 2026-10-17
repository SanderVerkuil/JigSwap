import { describe, expect, it } from "vitest";
import {
  memberInitials,
  normalizeMemberName,
  resolveMemberDisplayName,
} from "./display-name";

describe("normalizeMemberName", () => {
  it.each([
    [undefined, undefined],
    [null, undefined],
    ["", undefined],
    ["   ", undefined],
    ["null", undefined],
    ["null null", undefined],
    ["undefined undefined", undefined],
    ["Mara null", "Mara"],
    ["null Jansen", "Jansen"],
    ["  Mara Jansen  ", "Mara Jansen"],
    ["Mara van null Jansen", "Mara van null Jansen"],
    ["Nullah Nullson", "Nullah Nullson"],
  ])("%j -> %j", (raw, expected) => {
    expect(normalizeMemberName(raw)).toBe(expected);
  });
});

describe("resolveMemberDisplayName", () => {
  it("prefers the full name", () => {
    expect(
      resolveMemberDisplayName({
        name: "Mara Jansen",
        email: "mara@example.com",
        username: "mara",
      }),
    ).toEqual({ text: "Mara Jansen", kind: "name" });
  });

  it('falls back to the email when the name is missing or a legacy "null null"', () => {
    expect(
      resolveMemberDisplayName({
        name: "null null",
        email: "mara@example.com",
        username: "mara",
      }),
    ).toEqual({ text: "mara@example.com", kind: "email" });
  });

  it("falls back to the username when no (visible) email is supplied", () => {
    expect(resolveMemberDisplayName({ name: null, username: "mara" })).toEqual({
      text: "mara",
      kind: "username",
    });
  });

  it("returns undefined when nothing identifies the member", () => {
    expect(
      resolveMemberDisplayName({ name: " ", email: "", username: null }),
    ).toBeUndefined();
    expect(resolveMemberDisplayName({})).toBeUndefined();
  });
});

describe("memberInitials", () => {
  it("uses the first letter of whichever source was resolved", () => {
    expect(memberInitials({ text: "mara jansen", kind: "name" })).toBe("M");
    expect(memberInitials({ text: "jan@example.com", kind: "email" })).toBe(
      "J",
    );
    expect(memberInitials({ text: "_puzzler42", kind: "username" })).toBe("P");
    expect(memberInitials({ text: "émile", kind: "name" })).toBe("É");
  });

  it("is undefined when there is no resolved name (render an icon)", () => {
    expect(memberInitials(undefined)).toBeUndefined();
    expect(memberInitials({ text: "___", kind: "username" })).toBeUndefined();
  });
});

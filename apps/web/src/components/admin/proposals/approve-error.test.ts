import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import source from "../../../../locales/source.json";
import { approveErrorKey } from "./approve-error";

describe("approveErrorKey", () => {
  it("explains a suggestion whose text the catalogue refuses as too long", () => {
    expect(
      approveErrorKey(
        new ConvexError({
          code: "TextTooLong",
          message: "The description can be at most 5000 characters",
        }),
      ),
    ).toBe("approveTextTooLong");
  });

  it.each([
    ["a network failure", new Error("fetch failed")],
    ["a message-only refusal", new ConvexError("Forbidden")],
    ["another code", new ConvexError({ code: "ProposalNotPending" })],
  ])("keeps the generic message for %s", (_label, error) => {
    expect(approveErrorKey(error)).toBe("actionFailed");
  });

  it("every key it returns exists in English, Dutch and the source catalogue", () => {
    for (const key of ["approveTextTooLong", "actionFailed"] as const) {
      expect(en.admin.proposals[key]).toBeTruthy();
      expect(nl.admin.proposals[key]).toBeTruthy();
      expect(source.admin.proposals[key]).toBe(en.admin.proposals[key]);
    }
  });
});

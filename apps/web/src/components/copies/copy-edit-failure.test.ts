import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import { copyEditFailureKey } from "./copy-edit-failure";

describe("copyEditFailureKey", () => {
  it("names what it can, and says try again for anything else", () => {
    const refused = (code: string) => new ConvexError({ code, message: "no" });
    expect(copyEditFailureKey(refused("CopyReserved"))).toBe(
      "editCopy.copyReserved",
    );
    expect(copyEditFailureKey(refused("RateLimited"))).toBe(
      "editCopy.rateLimited",
    );
    expect(copyEditFailureKey(new Error("network"))).toBe(
      "editCopy.editFailed",
    );
  });

  it("every locale has the rate limit message", () => {
    for (const messages of [en, nl, source]) {
      expect(messages.copyInstance.editCopy.rateLimited).toBeTruthy();
    }
  });
});

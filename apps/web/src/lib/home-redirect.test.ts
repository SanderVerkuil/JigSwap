import { describe, expect, it } from "vitest";
import { shouldRedirectHomeToDashboard } from "./home-redirect";

describe("shouldRedirectHomeToDashboard", () => {
  it("redirects a signed-in visitor entering the site at /", () => {
    expect(
      shouldRedirectHomeToDashboard({ userId: "user_1", isDocumentLoad: true }),
    ).toBe(true);
  });

  it("shows / to a signed-in user navigating there in-app", () => {
    expect(
      shouldRedirectHomeToDashboard({
        userId: "user_1",
        isDocumentLoad: false,
      }),
    ).toBe(false);
  });

  it("always shows / to a signed-out visitor", () => {
    for (const isDocumentLoad of [true, false]) {
      expect(
        shouldRedirectHomeToDashboard({ userId: null, isDocumentLoad }),
      ).toBe(false);
      expect(
        shouldRedirectHomeToDashboard({ userId: undefined, isDocumentLoad }),
      ).toBe(false);
    }
  });
});

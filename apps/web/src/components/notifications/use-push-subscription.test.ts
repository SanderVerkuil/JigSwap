import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import { pushEnableErrorKey } from "./use-push-subscription";

describe("pushEnableErrorKey", () => {
  it("explains a push service the server refuses", () => {
    expect(
      pushEnableErrorKey(
        new ConvexError({ code: "InvalidPushSubscription", message: "x" }),
      ),
    ).toBe("pushServiceUnsupported");
  });

  it("explains the registration rate limit", () => {
    expect(
      pushEnableErrorKey(
        new ConvexError({ code: "RateLimited", retryAfterMs: 1000 }),
      ),
    ).toBe("pushRateLimited");
  });

  it("keeps the hint for a push service the browser can't reach", () => {
    expect(
      pushEnableErrorKey(
        new Error("PushManager.subscribe timed out after 15000ms"),
      ),
    ).toBe("pushServiceUnreachable");
  });

  it("leaves other failures to the generic message", () => {
    expect(pushEnableErrorKey(new Error("boom"))).toBeNull();
    expect(pushEnableErrorKey(new ConvexError({ code: "Other" }))).toBeNull();
  });

  it("has the copy in every locale", () => {
    for (const key of [
      "pushServiceUnsupported",
      "pushRateLimited",
      "pushServiceUnreachable",
    ] as const) {
      expect(en.notifications[key]).toBeTruthy();
      expect(nl.notifications[key]).toBeTruthy();
      expect(source.notifications[key]).toBe(en.notifications[key]);
    }
  });
});

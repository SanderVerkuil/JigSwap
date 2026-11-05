import { describe, expect, it } from "vitest";
import { requireAuth } from "./require-auth";

type Redirect = {
  options: { to: string; search: { redirect_url: string } };
};

const redirectFor = (href: string): Redirect => {
  try {
    requireAuth({ context: { userId: null }, location: { href } });
  } catch (thrown) {
    return thrown as Redirect;
  }
  throw new Error("expected a redirect");
};

describe("requireAuth", () => {
  it("lets a signed-in member through", () => {
    expect(
      requireAuth({
        context: { userId: "user_1" },
        location: { href: "/copies/abc?shared=1" },
      }),
    ).toEqual({ userId: "user_1" });
  });

  it("sends a signed-out visitor to sign-in, keeping where they were going", () => {
    const { options } = redirectFor("/copies/abc");
    expect(options.to).toBe("/sign-in/$");
    expect(options.search.redirect_url).toBe("/copies/abc");
  });

  // A puzzle link a member sent: its visitor usually has no account yet.
  it("sends the visitor of a sent puzzle link to sign-up, keeping the link", () => {
    const { options } = redirectFor("/copies/abc?shared=1");
    expect(options.to).toBe("/sign-up/$");
    expect(options.search.redirect_url).toBe("/copies/abc?shared=1");
  });
});

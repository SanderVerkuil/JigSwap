import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Capture the props the sign-in/up pages hand Clerk. Clerk's precedence is
// redirect_url query param > fallbackRedirectUrl, whereas forceRedirectUrl would
// override redirect_url. So /dashboard must be a *fallback*: an explicit target
// (lib/require-auth's redirect_url, an invite link, a catalog deep link) wins.
const captured: Record<string, Record<string, unknown>> = {};
vi.mock("@/compat/clerk", () => ({
  SignIn: (props: Record<string, unknown>) => {
    captured.signIn = props;
    return null;
  },
  SignUp: (props: Record<string, unknown>) => {
    captured.signUp = props;
    return null;
  },
}));

const { Route: SignInRoute } = await import("@/routes/sign-in.$");
const { Route: SignUpRoute } = await import("@/routes/sign-up.$");

describe("post-auth redirect target", () => {
  it.each([
    ["signIn", SignInRoute],
    ["signUp", SignUpRoute],
  ] as const)(
    "%s falls back to /dashboard without overriding redirect_url",
    (key, route) => {
      const Page = route.options.component!;
      renderToStaticMarkup(<Page />);
      expect(captured[key]?.fallbackRedirectUrl).toBe("/dashboard");
      expect(captured[key]).not.toHaveProperty("forceRedirectUrl");
      expect(captured[key]).not.toHaveProperty("signInForceRedirectUrl");
      expect(captured[key]).not.toHaveProperty("signUpForceRedirectUrl");
    },
  );
});

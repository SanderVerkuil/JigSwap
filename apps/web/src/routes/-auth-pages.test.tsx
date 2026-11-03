// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../locales/en.json";
import { Route as SignInRoute } from "./sign-in.$";
import { Route as SignUpRoute } from "./sign-up.$";

// The route modules only need their options back.
const location = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
  useLocation: ({ select }: { select: (value: typeof location) => unknown }) =>
    select(location),
}));

// It reads the backend: invite-sign-up-note.test.tsx covers what it says.
vi.mock("@/components/social/invite-sign-up-note", () => ({
  InviteSignUpNote: ({ redirectUrl }: { redirectUrl: unknown }) => (
    <div data-testid="invite-note" data-redirect={String(redirectUrl)} />
  ),
}));

vi.mock("@/components/auth/auth-shell", () => ({
  AuthShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="auth-shell">{children}</div>
  ),
}));

// Stand-ins that expose the props each Clerk card was given.
vi.mock("@/compat/clerk", () => ({
  SignIn: (props: Record<string, unknown>) => (
    <div data-testid="clerk-sign-in" data-props={JSON.stringify(props)} />
  ),
  SignUp: (props: Record<string, unknown>) => (
    <div data-testid="clerk-sign-up" data-props={JSON.stringify(props)} />
  ),
}));

const pageOf = (route: unknown) =>
  (route as { options: { component: ComponentType } }).options.component;

const propsOf = (testId: string): Record<string, unknown> =>
  JSON.parse(screen.getByTestId(testId).getAttribute("data-props") ?? "{}");

afterEach(() => {
  cleanup();
  location.search = {};
});

describe("sign-up for a member's puzzle link", () => {
  const renderSignUp = () => {
    const Page = pageOf(SignUpRoute);
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Page />
      </IntlProvider>,
    );
  };

  it("says why the visitor landed here", () => {
    location.search = { redirect_url: "/copies/abc?shared=1" };
    renderSignUp();
    expect(screen.getByText(en.auth.sharedPuzzle)).toBeTruthy();
  });

  it("hands the return address to the invite note, which decides whether to speak", () => {
    location.search = { redirect_url: "/members/hans?invite=abc" };
    renderSignUp();
    expect(screen.getByTestId("invite-note").dataset.redirect).toBe(
      "/members/hans?invite=abc",
    );
    expect(screen.queryByText(en.auth.sharedPuzzle)).toBeNull();
  });

  it("stays quiet for any other sign-up", () => {
    location.search = { redirect_url: "/dashboard" };
    renderSignUp();
    expect(screen.queryByText(en.auth.sharedPuzzle)).toBeNull();
  });
});

describe("auth pages", () => {
  it("links sign-in's 'Sign up' to the app's own sign-up page", () => {
    const Page = pageOf(SignInRoute);
    render(<Page />);
    expect(
      screen
        .getByTestId("auth-shell")
        .contains(screen.getByTestId("clerk-sign-in")),
    ).toBe(true);
    expect(propsOf("clerk-sign-in")).toMatchObject({
      signUpUrl: "/sign-up",
      fallbackRedirectUrl: "/dashboard",
    });
  });

  it("links sign-up's 'Sign in' to the app's own sign-in page", () => {
    const Page = pageOf(SignUpRoute);
    render(<Page />);
    expect(
      screen
        .getByTestId("auth-shell")
        .contains(screen.getByTestId("clerk-sign-up")),
    ).toBe(true);
    expect(propsOf("clerk-sign-up")).toMatchObject({
      signInUrl: "/sign-in",
      fallbackRedirectUrl: "/dashboard",
    });
  });
});

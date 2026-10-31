// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route as SignInRoute } from "./sign-in.$";
import { Route as SignUpRoute } from "./sign-up.$";

// The route modules only need their options back.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
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

afterEach(cleanup);

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

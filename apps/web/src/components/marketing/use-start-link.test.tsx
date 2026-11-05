// @vitest-environment happy-dom
import { FinalCTA } from "@/components/marketing/home/final-cta";
import { Route as FeaturesRoute } from "@/routes/_public/features";
import { Route as HowItWorksRoute } from "@/routes/_public/how-it-works";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";

const auth = vi.hoisted(() => ({ isAuthenticated: false }));
vi.mock("convex/react", () => ({ useConvexAuth: () => auth }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
}));

vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/marketing/reveal", () => ({
  Reveal: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

afterEach(() => {
  cleanup();
  auth.isAuthenticated = false;
});

const pageOf = (route: unknown) =>
  (route as { options: { component: ComponentType } }).options.component;

describe.each<[string, ComponentType]>([
  ["the home page's closing panel", FinalCTA],
  ["the features page", pageOf(FeaturesRoute)],
  ["the how it works page", pageOf(HowItWorksRoute)],
])("the start link on %s", (_name, Surface) => {
  const renderSurface = () =>
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Surface />
      </IntlProvider>,
    );

  it("invites a visitor to start", () => {
    renderSurface();
    expect(
      screen.getByRole("link", { name: "Start trading" }).getAttribute("href"),
    ).toBe("/sign-up");
  });

  it("takes a member to their dashboard, under that name", () => {
    auth.isAuthenticated = true;
    renderSurface();
    expect(screen.queryByRole("link", { name: "Start trading" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Dashboard" }).getAttribute("href"),
    ).toBe("/dashboard");
  });
});

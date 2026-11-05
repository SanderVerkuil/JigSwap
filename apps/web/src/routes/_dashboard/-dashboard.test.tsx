// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
// UX-05: the page root is the named container the pulse's columns respond to.
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./dashboard";

vi.mock("@/components/dashboard-home/briefing-hero", () => ({
  BriefingHero: () => null,
}));
vi.mock("@/components/dashboard-home/fresh-section", () => ({
  FreshSection: () => null,
}));
vi.mock("@/components/dashboard-home/pulse-section", () => ({
  PulseSection: () => null,
}));
vi.mock("@/components/dashboard-home/shelf-section", () => ({
  ShelfSection: () => null,
}));
vi.mock("@/components/dashboard-home/solving-now-section", () => ({
  SolvingNowSection: () => null,
}));
vi.mock("@/components/quick-start/quick-setup-card", () => ({
  QuickSetupCard: () => null,
}));
vi.mock("@/components/quick-start/welcome-dialog", () => ({
  WelcomeDialog: () => null,
}));
vi.mock("@/components/social/connection-offers", () => ({
  ConnectionOffersStrip: () => null,
}));

afterEach(cleanup);

describe("Dashboard page", () => {
  it("makes its root the named container for the pulse grid", () => {
    const DashboardPage = Route.options.component as ComponentType;
    const { container } = render(<DashboardPage />);
    expect(container.firstElementChild?.className.split(/\s+/)).toContain(
      "@container/dashboard",
    );
  });
});

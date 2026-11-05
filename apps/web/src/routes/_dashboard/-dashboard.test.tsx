// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
// UX-05: the page root is the named container the pulse's columns respond to.
import { cleanup, render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./dashboard";

// The sections are out of scope: only the page's root and what it publishes into the page head
// matter.
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
vi.mock("@/components/social/connection-offers", () => ({
  ConnectionOffersStrip: () => null,
}));

const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => viewport.mobile }));

const published = vi.hoisted(() => ({ actions: undefined as ReactNode }));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeaderActions: (render: () => ReactNode) => {
    published.actions = render();
  },
}));
vi.mock("@/components/tour/guide-help-button", () => ({
  GuideHelpButton: ({ tourId }: { tourId: string }) => (
    <button type="button" data-guide={tourId} />
  ),
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

function publishedActions() {
  const Page = Route.options.component;
  if (!Page) throw new Error("no page component");
  renderToStaticMarkup(<Page />);
  return renderToStaticMarkup(<>{published.actions}</>);
}

describe("Dashboard header", () => {
  it("publishes the getting-started guide's ? button (UX-91)", () => {
    viewport.mobile = false;
    expect(publishedActions()).toContain('data-guide="getting-started"');
  });

  it("publishes nothing on phones, where the ? would take a row of its own", () => {
    viewport.mobile = true;
    expect(publishedActions()).toBe("");
  });
});

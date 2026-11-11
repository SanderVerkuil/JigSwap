// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import nl from "../../locales/nl.json";
import { Route } from "./_public";

// The route module only needs its options back, and the layout the path it stands on.
const page = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
  Outlet: () => null,
  useLocation: ({
    select,
  }: {
    select: (location: { pathname: string }) => unknown;
  }) => select({ pathname: page.pathname }),
}));

// Stand-ins for the chrome: the header reports what the layout asked of it.
vi.mock("@/components/marketing/header", () => ({
  MarketingHeader: ({
    hideActionNearHero,
  }: {
    hideActionNearHero?: boolean;
  }) => <header data-hides-action={String(Boolean(hideActionNearHero))} />,
}));
vi.mock("@/components/marketing/footer", () => ({
  MarketingFooter: () => <footer />,
}));

afterEach(() => {
  cleanup();
  page.pathname = "/";
});

describe("public layout pending state", () => {
  it("says it is loading in the visitor's language", () => {
    const Pending = (
      Route as unknown as { options: { pendingComponent: ComponentType } }
    ).options.pendingComponent;
    render(
      <IntlProvider locale="nl" messages={nl} timeZone="Europe/Amsterdam">
        <Pending />
      </IntlProvider>,
    );
    expect(screen.getByText(nl.common.loading)).toBeTruthy();
  });
});

// F06: Features and How it works open with the same marigold action as the bar's.
describe("public layout header action", () => {
  const hidesAction = (pathname: string) => {
    page.pathname = pathname;
    const Layout = (
      Route as unknown as { options: { component: ComponentType } }
    ).options.component;
    const { container, unmount } = render(<Layout />);
    const hides = container
      .querySelector("header")
      ?.getAttribute("data-hides-action");
    unmount();
    return hides;
  };

  it("hides the bar's action near the hero on the pages whose hero has it", () => {
    expect(hidesAction("/features")).toBe("true");
    expect(hidesAction("/how-it-works")).toBe("true");
  });

  it("keeps it in the bar on every other public page", () => {
    expect(hidesAction("/about")).toBe("false");
    expect(hidesAction("/contact")).toBe("false");
    expect(hidesAction("/docs/getting-started")).toBe("false");
  });
});

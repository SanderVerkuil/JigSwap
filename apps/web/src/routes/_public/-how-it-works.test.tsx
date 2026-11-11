// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { Route } from "./how-it-works";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
}));

vi.mock("@/compat/link", () => ({
  Link: ({ href, ...rest }: ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest} />
  ),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: false }),
}));

vi.mock("@/components/marketing/reveal", () => ({
  Reveal: ({ children }: { children?: ReactNode }) => (
    <div data-reveal="">{children}</div>
  ),
}));

afterEach(cleanup);

const renderPage = () => {
  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  return render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <Page />
    </IntlProvider>,
  );
};

describe("how it works headings", () => {
  it("never skips a level on the way down", () => {
    renderPage();

    const levels = screen
      .getAllByRole("heading")
      .map((heading) => Number(heading.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]).toBeLessThanOrEqual(1);
    });
  });
});

describe("how it works start action", () => {
  // F06: the public pages share one large action, the one the home page uses, with no arrow.
  it("is the public action wherever it shows, without an arrow", () => {
    renderPage();
    const actions = screen.getAllByRole("link", { name: "Start your shelf" });
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.className.split(/\s+/)).toEqual(
        expect.arrayContaining(["h-[50px]", "rounded-[10px]", "font-bold"]),
      );
      expect(action.querySelector("svg")).toBeNull();
    }
  });

  // F06: the header hides its own copy while the hero's is in view.
  it("marks the hero's copy for the header", () => {
    const { container } = renderPage();
    const marked = container.querySelectorAll("[data-hero-action]");
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toBe("Start your shelf");
  });
});

// F93: entrances on section headings and their intro only, never on art, rows, answers or actions.
describe("how it works entrances", () => {
  it("lets only headings enter", () => {
    const { container } = renderPage();
    const reveals = Array.from(container.querySelectorAll("[data-reveal]"));
    expect(reveals.length).toBeGreaterThan(0);
    for (const reveal of reveals) {
      expect(reveal.firstElementChild?.tagName).toBe("H2");
      expect(reveal.querySelector("img, a, button, dl, h3")).toBeNull();
    }
  });
});

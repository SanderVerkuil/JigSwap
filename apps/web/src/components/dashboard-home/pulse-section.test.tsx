// @vitest-environment happy-dom
// UX-05: the pulse's three columns follow the dashboard content's width, not the viewport, so a
// tablet with the icon rail gets them and a docked sidebar at the same viewport does not squeeze
// them. The loading skeleton keeps the same grid, so nothing jumps when the data arrives.
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { PulseSection } from "./pulse-section";

const mocks = vi.hoisted(() => ({ loaded: true }));

vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("./use-current-member", () => ({
  useCurrentMember: () => ({
    member: { _id: "member_1" },
    isPending: false,
  }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: !mocks.loaded
      ? undefined
      : String(queryKey[1]).includes("History")
        ? { page: [], isDone: true, continueCursor: "" }
        : [],
  }),
}));

afterEach(() => {
  cleanup();
  mocks.loaded = true;
});

function renderedGridClasses() {
  const { container } = render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <PulseSection />
    </IntlProvider>,
  );
  return container.firstElementChild?.className.split(/\s+/);
}

describe("PulseSection grid", () => {
  it.each([
    ["the loaded section", true],
    ["the loading skeleton", false],
  ])("lays out %s by its container's width", (_, loaded) => {
    mocks.loaded = loaded;
    const classes = renderedGridClasses();
    expect(classes).toContain("@2xl/dashboard:grid-cols-[1.15fr_0.85fr_1.1fr]");
    expect(classes?.some((name) => name.startsWith("lg:"))).toBe(false);
  });
});

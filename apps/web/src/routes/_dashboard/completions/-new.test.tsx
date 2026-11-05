// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
// UX-157: an explicit crumb trail starts at its nav group's landing page.
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { Route } from "./new";

const mocks = vi.hoisted(() => ({
  header: undefined as
    | { title?: unknown; crumbs?: { label: string; href?: string }[] }
    | undefined,
}));

vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: null }),
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: undefined, isPending: true }),
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeader: (factory: () => NonNullable<typeof mocks.header>) => {
    mocks.header = factory();
  },
}));

afterEach(cleanup);

describe("Log a solve page head", () => {
  it("roots the crumbs at My Library", () => {
    const NewCompletionPage = Route.options.component as ComponentType;
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <NewCompletionPage />
      </IntlProvider>,
    );
    expect(mocks.header?.crumbs).toEqual([
      { label: en.shell.groups.library.label, href: "/library" },
      { label: en.shell.pages.completions.title, href: "/completions" },
    ]);
  });
});

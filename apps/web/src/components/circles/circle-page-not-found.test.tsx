// @vitest-environment happy-dom
// A circle the viewer can't see (getCircle returns null) is the shell's 404, titled in the page head.
// CirclePage publishes the head itself, and its publish runs after (and overwrites) one from the
// 404 inside it, so it has to carry the not-found title: "Page not found", not "Circles".
import { PageHead } from "@/components/dashboard-layout/page-head";
import { PageHeaderSlotProvider } from "@/components/dashboard-layout/page-header-slot";
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { CirclePage } from "./circle-page";

vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { id: "clerk_me", firstName: "Henk" } }),
}));

vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "me" }, isMemberLoading: false }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useLocation: (opts?: {
    select?: (location: { pathname: string }) => unknown;
  }) => {
    const location = { pathname: "/circles/circle_1" };
    return opts?.select ? opts.select(location) : location;
  },
}));

const CIRCLE = "circle_1";
const circleKey = convexQuery(gateway.sharing.circle, {
  circleId: CIRCLE,
}).queryKey;

const renderPage = (locale: "en" | "nl" = "en") => {
  const convexQueryClient = new ConvexQueryClient(
    new ConvexReactClient("https://example.convex.cloud"),
  );
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        staleTime: Infinity,
        retry: false,
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <PageHeaderSlotProvider>
          <PageHead />
          <main>
            <CirclePage circleId={CIRCLE} />
          </main>
        </PageHeaderSlotProvider>
      </IntlProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
};

// The read answers after the page has mounted on its loading state, as it does in the app. The
// query client notifies its observers on a later tick, hence the async act.
const resolveCircle = (queryClient: QueryClient, circle: null) =>
  act(async () => {
    queryClient.setQueryData(circleKey, circle);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const head = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot="page-head"]')!;

afterEach(cleanup);

describe("CirclePage for a circle the viewer can't see", () => {
  it("titles the page head 'Page not found', with no breadcrumb and no h1 in the page", async () => {
    const { container, queryClient } = renderPage();
    await resolveCircle(queryClient, null);

    const h1 = within(head(container)).getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe(en.notFound.title);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("navigation")).toBeNull();

    const main = screen.getByRole("main");
    expect(within(main).getByText(en.notFound.description)).toBeTruthy();
    expect(
      within(main)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual(["/dashboard", "/browse"]);
  });

  it("does so in Dutch", async () => {
    const { container, queryClient } = renderPage("nl");
    await resolveCircle(queryClient, null);

    expect(
      within(head(container)).getByRole("heading", { level: 1 }).textContent,
    ).toBe(nl.notFound.title);
  });
});

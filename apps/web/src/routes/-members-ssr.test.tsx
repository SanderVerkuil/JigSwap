// @vitest-environment node
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { gateway } from "@/gateway";
import { SSR_MEMBER_DATA_BUDGET_MS } from "@/lib/ssr-member-data";
import { convexQuery } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getFunctionName } from "convex/server";
import type { ComponentType, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../locales/en.json";
import { Route } from "./members.$handle";

// /members/$handle reads on the server for everyone, and its answers depend on who is asking: a
// mutual follower opens a profile that nobody else may. So those reads may never run as nobody for a
// signed-in viewer, and no visitor who isn't signed in pays for a call to Clerk.

const NOT_FOUND = { isNotFound: true } as const;
const clerk = vi.hoisted(() => ({
  getToken: vi.fn<(options: object) => Promise<string | null>>(),
}));
const viewer = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@clerk/tanstack-react-start/server", () => ({
  auth: async () => ({ userId: viewer.userId, getToken: clerk.getToken }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useParams: () => ({ handle: "anna" }),
    useSearch: () => ({}),
    useRouteContext: () => undefined,
  }),
  notFound: () => NOT_FOUND,
  redirect: (to: object) => ({ redirect: to }),
  useRouteContext: () => ({ userId: viewer.userId }),
  useLocation: ({ select }: { select: (l: { pathname: string }) => unknown }) =>
    select({ pathname: "/members/anna" }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/components/dashboard-layout/shell", () => ({
  DashboardShell: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("@/components/marketing/header", () => ({
  MarketingHeader: () => null,
}));
vi.mock("@/components/marketing/footer", () => ({
  MarketingFooter: () => null,
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
}));

const PROFILE = {
  locked: false,
  hero: { memberId: "anna", handle: "anna", displayName: "Anna" },
};
const name = getFunctionName;

type LoaderResult = { profile: { hero: { displayName: string } } | null };
type LoaderFn = (input: {
  context: object;
  params: { handle: string };
  deps: object;
}) => Promise<LoaderResult>;
const { loader, component: Page } = (
  Route as unknown as {
    options: { loader: LoaderFn; component: ComponentType };
  }
).options;

// A server's clients, answering each read from `answers`, in the order the page asks.
const server = (answers: Record<string, unknown>) => {
  const setAuth = vi.fn();
  const order: string[] = [];
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: ({ queryKey }) => {
          order.push(setAuth.mock.calls.length > 0 ? "read as member" : "read");
          return answers[queryKey[1] as string];
        },
      },
    },
  });
  const load = () =>
    loader({
      context: {
        userId: viewer.userId,
        queryClient,
        convexQueryClient: { serverHttpClient: { setAuth } },
      },
      params: { handle: "anna" },
      deps: {},
    });
  return { load, queryClient, setAuth, order };
};

beforeEach(() => {
  viewer.userId = null;
  clerk.getToken.mockReset();
  clerk.getToken.mockResolvedValue("jwt");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the member page's loader on the server", () => {
  it("reads as a signed-in viewer, so a profile only they may open loads", async () => {
    viewer.userId = "user_1";
    const { load, setAuth, order } = server({
      [name(gateway.social.publicProfile)]: PROFILE,
    });
    const { profile } = await load();
    expect(profile?.hero.displayName).toBe("Anna");
    expect(setAuth).toHaveBeenCalledExactlyOnceWith("jwt");
    expect(order).toEqual(["read as member"]);
  });

  it("calls Clerk for no signed-out visitor, and a profile nobody can see is a 404", async () => {
    const { load, setAuth } = server({
      [name(gateway.social.publicProfile)]: null,
      [name(gateway.social.publicMemberTeaser)]: null,
    });
    await expect(load()).rejects.toBe(NOT_FOUND);
    expect(clerk.getToken).not.toHaveBeenCalled();
    expect(setAuth).not.toHaveBeenCalled();
  });

  it("leaves the page to the browser when Clerk is slow, instead of reading as nobody", async () => {
    vi.useFakeTimers();
    viewer.userId = "user_1";
    clerk.getToken.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 5_000, "late");
        }),
    );
    const { load, order, setAuth } = server({
      [name(gateway.social.publicProfile)]: null,
      [name(gateway.social.publicMemberTeaser)]: null,
    });
    const loading = load();
    await vi.advanceTimersByTimeAsync(SSR_MEMBER_DATA_BUDGET_MS);
    await expect(loading).resolves.toEqual({ profile: null });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(order).toEqual([]);
    expect(setAuth).not.toHaveBeenCalled();
  });

  it("leaves the page to the browser when Clerk fails too", async () => {
    viewer.userId = "user_1";
    clerk.getToken.mockRejectedValue(new Error("Clerk down"));
    const { load, order } = server({});
    await expect(load()).resolves.toEqual({ profile: null });
    expect(order).toEqual([]);
  });
});

describe("the member page itself", () => {
  const paint = (queryClient: QueryClient) =>
    renderToString(
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
          <Page />
        </IntlProvider>
      </QueryClientProvider>,
    );
  // Reads still out stay out: what's in the cache is what the page has.
  const browserClient = () =>
    new QueryClient({
      defaultOptions: { queries: { queryFn: () => new Promise(() => {}) } },
    });
  const profileKey = convexQuery(gateway.social.publicProfile, {
    handle: "anna",
  }).queryKey;
  const teaserKey = convexQuery(gateway.social.publicMemberTeaser, {
    handle: "anna",
  }).queryKey;

  it("waits on its own reads when the loader left it to the browser", () => {
    viewer.userId = "user_1";
    const html = paint(browserClient());
    expect(html).toContain(en.members.loading);
    expect(html).not.toContain(en.members.notFoundSub);
  });

  // The loader's 404 never ran for this load, so without this the wait above would never end. The
  // title goes to the shell's page head; the body says why and offers the way back.
  it("says not found when the browser's own reads find nobody", () => {
    viewer.userId = "user_1";
    const queryClient = browserClient();
    queryClient.setQueryData(profileKey, null);
    queryClient.setQueryData(teaserKey, null);
    const html = paint(queryClient);
    expect(html).toContain(en.members.notFoundSub);
    expect(html).toContain(en.members.findPeople);
    expect(html).not.toContain(en.members.loading);
  });

  it("keeps waiting while the fallback read is still out", () => {
    viewer.userId = "user_1";
    const queryClient = browserClient();
    queryClient.setQueryData(profileKey, null);
    expect(paint(queryClient)).toContain(en.members.loading);
  });
});

// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { MobileTopBar } from "./mobile-top-bar";
import { PageHead } from "./page-head";
import {
  PageHeaderSlotProvider,
  usePageHeader,
  type PageHeaderContent,
} from "./page-header-slot";
import { ShellDocumentTitle, ShellHeading } from "./shell-title";

// One h1 per page (UX-66). The desktop page head's title is the h1 from md (the head itself is
// hidden below md); below md an sr-only ShellHeading inside main is the h1, and the top-bar title
// is plain text in the banner. A page that renders its own h1 opts out with `ownsHeading`, and
// the shell then prints its title without a heading.

const route = vi.hoisted(() => ({ pathname: "/my-puzzles" }));

vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { id: "user_me", firstName: "Henk" } }),
}));
vi.mock("@/compat/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    activeOptions,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
    activeOptions?: { exact?: boolean };
  }) => (
    <a href={href} data-exact-active={activeOptions?.exact} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    history: { canGoBack: () => false, subscribe: () => () => {} },
  }),
}));
vi.mock("./nav-counts", () => ({ useUnreadMessageCount: () => 0 }));
vi.mock("./shell-user-button", () => ({ ShellUserButton: () => null }));

function Publish({ content }: { content: PageHeaderContent }) {
  usePageHeader(() => content, [content]);
  return null;
}

const renderShell = (pathname: string, content?: PageHeaderContent) => {
  route.pathname = pathname;
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
  queryClient.setQueryData(
    convexQuery(gateway.notifications.unreadCount, {}).queryKey,
    0,
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <PageHeaderSlotProvider>
          <MobileTopBar onOpenPalette={() => {}} />
          <PageHead />
          <main>
            <ShellHeading />
            {content && <Publish content={content} />}
          </main>
        </PageHeaderSlotProvider>
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const h1s = (root: ParentNode) => Array.from(root.querySelectorAll("h1"));

afterEach(cleanup);

describe("shell page title headings", () => {
  it("keeps the mobile top-bar title out of the heading outline", () => {
    const { container } = renderShell("/my-puzzles");
    const banner = container.querySelector("header")!;
    expect(h1s(banner)).toHaveLength(0);
    expect(banner.querySelector("p")?.textContent).toBe("My Puzzles");
  });

  it("gives phones an sr-only h1 inside main, hidden from md where the page head's h1 shows", () => {
    const { container } = renderShell("/my-puzzles");
    const phone = container.querySelector("main h1")!;
    expect(phone.textContent).toBe("My Puzzles");
    expect(phone.className.split(" ")).toEqual(
      expect.arrayContaining(["sr-only", "md:hidden"]),
    );
    // The page head (itself `hidden md:block`) carries the desktop h1.
    const desktop = h1s(container).filter((h) => !h.closest("main"));
    expect(desktop.map((h) => h.textContent)).toEqual(["My Puzzles"]);
  });

  it("names the phone home page with the greeting and drops the logo's duplicate alt", () => {
    const { container } = renderShell("/dashboard");
    expect(container.querySelector("main h1")?.textContent).toBe(
      "Welcome back, Henk!",
    );
    // The wordmark next to the logo already says JigSwap.
    expect(container.querySelector("header img")?.getAttribute("alt")).toBe("");
  });

  it("renders no shell h1 when the page owns its heading", () => {
    const { container } = renderShell("/puzzles/p1", {
      title: "Café",
      ownsHeading: true,
    });
    expect(h1s(container)).toHaveLength(0);
    // The title still shows in the page head and the top bar, as plain text.
    expect(
      Array.from(container.querySelectorAll("p")).filter(
        (p) => p.textContent === "Café",
      ),
    ).toHaveLength(2);
  });

  it("renders no shell h1 and no title line when the title is in the page's content", () => {
    const { container } = renderShell("/puzzles/p1", {
      title: "Café",
      titleInContent: true,
    });
    expect(h1s(container)).toHaveLength(0);
    // The breadcrumb keeps the leaf; only the top bar still prints it as a title.
    expect(
      Array.from(container.querySelectorAll("p")).filter(
        (p) => p.textContent === "Café",
      ),
    ).toHaveLength(1);
  });

  it('keeps the page head h1 from md when the page owns its h1 only below md ("phone")', () => {
    const { container } = renderShell("/copies/c1", {
      title: "Café",
      ownsHeading: "phone",
    });
    // No sr-only phone heading in main; the page head (hidden below md) is the only shell h1.
    expect(container.querySelector("main h1")).toBeNull();
    expect(h1s(container).map((h) => h.textContent)).toEqual(["Café"]);
  });

  it("keeps the shell h1 for a published title the page does not render itself", () => {
    const { container } = renderShell("/circles/c1", { title: "Book club" });
    expect(h1s(container).map((h) => h.textContent)).toEqual([
      "Book club",
      "Book club",
    ]);
  });
});

// The router's head() runs before a detail page's data is in, so it can only say "My puzzles". The
// shell names the tab after the title the page publishes, and hands the tab back on the way out.
describe("ShellDocumentTitle", () => {
  const ROUTE_TITLE = "My puzzles — JigSwap";

  const renderTitle = (content: PageHeaderContent) => {
    const tree = (published: PageHeaderContent) => (
      <PageHeaderSlotProvider>
        <ShellDocumentTitle />
        <Publish content={published} />
      </PageHeaderSlotProvider>
    );
    const view = render(tree(content));
    return { update: (next: PageHeaderContent) => view.rerender(tree(next)) };
  };

  beforeEach(() => {
    document.title = ROUTE_TITLE;
  });

  it("names the tab after the title the page publishes", () => {
    renderTitle({ title: "Oostenrijk, Tirol" });
    expect(document.title).toBe("Oostenrijk, Tirol — JigSwap");
  });

  it("keeps the route's title while nothing is published yet, then follows renames", () => {
    const { update } = renderTitle({ title: undefined });
    expect(document.title).toBe(ROUTE_TITLE);
    update({ title: "Café" });
    expect(document.title).toBe("Café — JigSwap");
    update({ title: "Bistro" });
    expect(document.title).toBe("Bistro — JigSwap");
  });

  it("puts the route's title back when the page goes, since the router won't redo an unchanged one", () => {
    const { update } = renderTitle({ title: "Café" });
    update({});
    expect(document.title).toBe(ROUTE_TITLE);
  });

  it("leaves a title alone that the next route's head has already set", () => {
    const { update } = renderTitle({ title: "Café" });
    document.title = "Owned copy — JigSwap";
    update({});
    expect(document.title).toBe("Owned copy — JigSwap");
  });

  // Switching language re-runs the router's head on the same page.
  it("takes the tab back when the router's head changes under it, then hands that one back", async () => {
    const { update } = renderTitle({ title: "Café" });
    document.title = "Mijn puzzels — JigSwap";
    await vi.waitFor(() => expect(document.title).toBe("Café — JigSwap"));
    update({});
    expect(document.title).toBe("Mijn puzzels — JigSwap");
  });

  it("leaves the tab alone for a title that is not plain text", () => {
    renderTitle({ title: <em>Café</em> });
    expect(document.title).toBe(ROUTE_TITLE);
  });
});

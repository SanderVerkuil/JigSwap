// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render as mount,
  screen,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hero } from "./hero";

vi.mock("@/components/marketing/use-start-link", () => ({
  useStartLink: () => ({ href: "/sign-up", label: "Start your shelf" }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const stats = vi.hoisted(() => ({ totalUsers: 1 }));
vi.mock("@/lib/marketing-queries", () => ({
  globalStatsQuery: {},
  hasSocialProof: (s: { totalUsers: number }) => s.totalUsers >= 50,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: stats }),
}));

function withIntl(locale: "en" | "nl") {
  const messages = JSON.parse(
    readFileSync(
      resolve(__dirname, `../../../../locales/${locale}.json`),
      "utf8",
    ),
  ) as Record<string, never>;
  return (
    <IntlProvider
      locale={locale}
      messages={messages}
      timeZone="Europe/Amsterdam"
    >
      <Hero />
    </IntlProvider>
  );
}

function render(locale: "en" | "nl") {
  return renderToStaticMarkup(withIntl(locale));
}

// A 1024x768 landscape tablet: the shelf sits under the house with its first box ending at 1143, below
// the fold. Each name pin's top is where it stands on screen.
function layOut({ wide }: { wide: boolean }) {
  const pinTop: Record<string, number> = { Sanne: 406, Marieke: 659 };
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query === "(max-width: 1179px)" && !wide,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const top =
        this.tagName === "IMG" && this.closest("aside")
          ? 1043
          : this.parentElement?.matches("button[aria-pressed]")
            ? (pinTop[this.textContent ?? ""] ?? 0)
            : 0;
      return { top, bottom: top + 100 } as DOMRect;
    },
  );
  return vi.spyOn(window, "scrollBy").mockImplementation(() => {});
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Hero", () => {
  it("server-renders three floor buttons with Opa Wim chosen and her shelf docked", () => {
    const html = render("en");
    // The name sits inside the floor's button, after the floor's dim.
    const pressed = [
      ...html.matchAll(
        /aria-pressed="(true|false)".*?([^<>]+)<\/span><\/button>/g,
      ),
    ].map(([, state, name]) => [name, state]);
    expect(pressed).toEqual([
      ["Sanne", "false"],
      ["Opa Wim", "true"],
      ["Marieke", "false"],
    ]);
    expect(html).toContain("Opa Wim’s shelf");
    expect(html).toContain("Dorpsstraat");
    expect(html).not.toContain("Theekoepel");
  });

  it("links every ask to the start href", () => {
    const html = render("en");
    expect(
      html.match(/href="\/sign-up"[^>]*aria-label="Ask to borrow/g),
    ).toHaveLength(3);
  });

  it("invites visitors to be among the first until the community is big enough", () => {
    stats.totalUsers = 49;
    expect(render("en")).toContain("Be one of our first puzzlers");
    expect(render("en")).not.toContain("have a shelf here");
  });

  it("then shows the live count", () => {
    stats.totalUsers = 50;
    expect(render("en")).toContain("50 puzzlers have a shelf here.");
    expect(render("nl")).toContain("50 puzzelaars hebben hier een plank.");
  });

  it("formats piece counts for the locale", () => {
    expect(render("en")).toContain("1,000 pieces");
    expect(render("nl")).toContain("1.000 stukjes");
  });

  it("lets the title wrap instead of clipping when a reader widens the text spacing", () => {
    const h1 = render("en").match(/<h1[^>]*>/)?.[0];
    expect(h1).toContain("text-balance");
    expect(h1).not.toContain("nowrap");
  });

  it("keeps the lead off the main gable's apex from 1180 to 1239px at every height", () => {
    const lead = render("nl").match(/<h1.*?<\/h1><p[^>]*>/)?.[0];
    expect(lead).toContain("min-[1180px]:max-[1240px]:max-w-[560px]");
    expect(lead).toContain("min-[1180px]:max-[1240px]:text-[18px]");
  });

  it("from 1180px, the trust line follows the link where it fits and wraps above the button where it doesn't", () => {
    stats.totalUsers = 1;
    const action = render("en").match(
      /<div data-hero-action[^>]*>.*?<\/div>/,
    )?.[0];
    expect(action).toContain("min-[1180px]:flex-wrap-reverse");
    // Read in order: the action, the catalogue, then the trust line, which is never moved by CSS order.
    const order = [...(action ?? "").matchAll(/<(a|p)\b[^>]*>([^<]*)/g)].map(
      ([, tag, text]) => `${tag}:${text}`,
    );
    expect(order).toEqual([
      "a:Start your shelf",
      "a:Browse puzzles",
      "p:Be one of our first puzzlers",
    ]);
    expect(action).not.toContain("order-first");
  });

  it("below 1180px, choosing a floor scrolls toward its shelf but keeps the chosen name under the header", () => {
    const scrollBy = layOut({ wide: false });
    mount(withIntl("en"));
    // Sanne's name would go under the header first: the scroll stops 16px below the 64px header.
    fireEvent.click(screen.getByRole("button", { name: "Sanne" }));
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 326, behavior: "smooth" });
    // Marieke's name stays clear, so the scroll goes all the way to the first box (16px under it).
    fireEvent.click(screen.getByRole("button", { name: "Marieke" }));
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 391, behavior: "smooth" });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Marieke’s shelf",
    );
  });

  it("leaves the scroll alone once the shelf docks beside the house", () => {
    const scrollBy = layOut({ wide: true });
    mount(withIntl("en"));
    fireEvent.click(screen.getByRole("button", { name: "Sanne" }));
    expect(scrollBy).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Sanne’s shelf",
    );
  });

  it("loads only the house eagerly, with its size declared", () => {
    const images = render("en").match(/<img[^>]*>/g) ?? [];
    const house = images.filter((img) => img.includes("fetchPriority"));
    expect(house).toHaveLength(1);
    expect(house[0]).toContain('width="2400"');
    expect(house[0]).toContain('height="1578"');
    expect(house[0]).not.toContain("lazy");
    for (const img of images.filter((i) => !i.includes("fetchPriority"))) {
      expect(img).toContain('loading="lazy"');
    }
  });
});

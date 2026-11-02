import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
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

function render(locale: "en" | "nl") {
  const messages = JSON.parse(
    readFileSync(
      resolve(__dirname, `../../../../locales/${locale}.json`),
      "utf8",
    ),
  ) as Record<string, never>;
  return renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={messages}
      timeZone="Europe/Amsterdam"
    >
      <Hero />
    </IntlProvider>,
  );
}

describe("Hero", () => {
  it("server-renders three floor buttons with Opa Wim chosen and her shelf docked", () => {
    const html = render("en");
    const pressed = [
      ...html.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)</g),
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

  it("loads only the house eagerly, with its size declared", () => {
    const images = render("en").match(/<img[^>]*>/g) ?? [];
    const house = images.filter((img) => img.includes("fetchPriority"));
    expect(house).toHaveLength(1);
    expect(house[0]).toContain('width="2000"');
    expect(house[0]).toContain('height="1228"');
    expect(house[0]).not.toContain("lazy");
    for (const img of images.filter((i) => !i.includes("fetchPriority"))) {
      expect(img).toContain('loading="lazy"');
    }
  });
});

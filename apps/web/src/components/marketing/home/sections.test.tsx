// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeatureRows } from "./feature-rows";
import { FinalCTA } from "./final-cta";
import { HowPreview } from "./how-preview";
import { Sustain } from "./sustain";

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
// Marks what enters on scroll, and with what delay.
vi.mock("@/components/marketing/reveal", () => ({
  Reveal: ({
    delay = 0,
    className,
    children,
  }: {
    delay?: number;
    className?: string;
    children: React.ReactNode;
  }) => (
    <div data-reveal="" data-delay={delay} className={className}>
      {children}
    </div>
  ),
}));

const messages = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../locales/en.json"), "utf8"),
) as Record<string, never>;

function mount(section: React.ReactNode) {
  return render(
    <IntlProvider locale="en" messages={messages} timeZone="Europe/Amsterdam">
      {section}
    </IntlProvider>,
  ).container;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("home sections", () => {
  it.each([
    ["FeatureRows", <FeatureRows key="rows" />],
    ["HowPreview", <HowPreview key="how" />],
    ["Sustain", <Sustain key="sustain" />],
    ["FinalCTA", <FinalCTA key="cta" />],
  ])(
    "%s reveals only headings and intro text, at most 70ms apart",
    (_, section) => {
      const container = mount(section);
      const reveals = [...container.querySelectorAll("[data-reveal]")];
      expect(reveals.length).toBeGreaterThan(0);
      for (const reveal of reveals) {
        expect(Number(reveal.getAttribute("data-delay"))).toBeLessThanOrEqual(
          70,
        );
      }
      // Cards, pictures, quotes, lists and actions are there from the start.
      for (const el of container.querySelectorAll(
        "img, a, blockquote, ul, button",
      )) {
        expect(el.closest("[data-reveal]")).toBeNull();
      }
    },
  );

  it("keeps the closing action and the lending slip out of any entrance", () => {
    const cta = mount(<FinalCTA />);
    const start = cta.querySelector('a[href="/sign-up"]');
    expect(start?.textContent).toBe("Start your shelf");
    expect(start?.closest("[data-reveal]")).toBeNull();
    cleanup();
    const how = mount(<HowPreview />);
    const slip = how.querySelector("ul")?.closest(".bg-mk-card");
    expect(slip).not.toBeNull();
    expect(slip?.closest("[data-reveal]")).toBeNull();
  });

  it("Sustain's kitchen table keeps its own shape from 760px, so the page doesn't grow when it loads", () => {
    const img = mount(<Sustain />).querySelector("img");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("width")).toBe("2400");
    expect(img?.getAttribute("height")).toBe("903");
    expect(img?.className).toContain("min-[760px]:aspect-[2400/903]");
    expect(img?.className).not.toContain("aspect-auto");
  });

  it("the marigold storey stands its park on a plank ledge, and the park stands still", () => {
    const animate = vi.spyOn(Element.prototype, "animate");
    const storey = mount(<FeatureRows />).querySelector("article.bg-mk-gold");
    const bridge = storey?.querySelector("img");
    expect(bridge?.getAttribute("alt")).toBeTruthy();
    const ledge = storey?.lastElementChild;
    expect(ledge?.className).toContain("bg-mk-plank");
    expect(
      bridge!.compareDocumentPosition(ledge!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(bridge?.getAttribute("style")).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it("holds each stuck storey for only a short moment", () => {
    const holds = mount(<FeatureRows />).querySelectorAll(
      "section > div[aria-hidden]",
    );
    expect(holds).toHaveLength(3);
    for (const hold of holds) expect(hold.className).toContain("h-[12svh]");
  });
});

import { SidebarMenu, SidebarProvider } from "@/components/ui/sidebar";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { WhatsNewCountPill, WhatsNewNavItem } from "./badges";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const withIntl = (node: ReactNode, locale: "en" | "nl" = "en") =>
  renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      {node}
    </IntlProvider>,
  );

const navItem = (count: number, locale: "en" | "nl" = "en") =>
  withIntl(
    <SidebarProvider>
      <SidebarMenu>
        <WhatsNewNavItem count={count} active={false} />
      </SidebarMenu>
    </SidebarProvider>,
    locale,
  );

type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];

const isElement = (node: Node): node is Element => "tagName" in node;

const parse = (html: string): Element[] => {
  const out: Element[] = [];
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      out.push(node);
      walk(node.childNodes);
    }
  };
  walk(parseFragment(html).childNodes);
  return out;
};

const attr = (el: Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value;

const classes = (el: Element) => (attr(el, "class") ?? "").split(/\s+/);

const textOf = (el: Element): string =>
  el.childNodes
    .map((child) =>
      isElement(child) ? textOf(child) : "value" in child ? child.value : "",
    )
    .join("");

describe("WhatsNewNavItem", () => {
  it("links to /whats-new as a tour target and carries the count in its name", () => {
    const els = parse(navItem(2));
    const link = els.find((el) => el.tagName === "a")!;
    expect(attr(link, "href")).toBe("/whats-new");
    expect(attr(link, "data-tour")).toBe("whats-new-entry");
    expect(textOf(link)).toBe("What's new2 new updates");
    const sr = parse(navItem(2)).find(
      (el) => classes(el).includes("sr-only") && el.tagName === "span",
    )!;
    expect(textOf(sr)).toBe("2 new updates");
  });

  it("shows an aria-hidden count pill and a collapsed-rail dot when unread", () => {
    const els = parse(navItem(12));
    const pill = els.find((el) => attr(el, "data-sidebar") === "menu-badge")!;
    expect(attr(pill, "aria-hidden")).toBe("true");
    expect(textOf(pill)).toBe("9+");
    expect(classes(pill)).toEqual(
      expect.arrayContaining(["bg-primary", "dark:bg-violet-300"]),
    );
    const dot = els.find((el) =>
      classes(el).includes("group-data-[collapsible=icon]:block"),
    )!;
    expect(attr(dot, "aria-hidden")).toBe("true");
    expect(classes(dot)).toContain("bg-jigsaw-primary-accent");
  });

  it("renders no pill, dot or count text when everything is read", () => {
    const els = parse(navItem(0));
    expect(els.some((el) => attr(el, "data-sidebar") === "menu-badge")).toBe(
      false,
    );
    expect(els.some((el) => classes(el).includes("sr-only"))).toBe(false);
    expect(textOf(els.find((el) => el.tagName === "a")!)).toBe("What's new");
  });

  it("is translated", () => {
    const link = parse(navItem(1, "nl")).find((el) => el.tagName === "a")!;
    expect(textOf(link)).toBe("Wat is er nieuw1 nieuwe update");
  });
});

describe("WhatsNewCountPill", () => {
  it("renders the capped, aria-hidden count", () => {
    const [pill] = parse(withIntl(<WhatsNewCountPill count={3} />));
    expect(textOf(pill!)).toBe("3");
    expect(attr(pill!, "aria-hidden")).toBe("true");
    expect(classes(pill!)).toContain("tabular-nums");
  });

  it("renders nothing at zero", () => {
    expect(withIntl(<WhatsNewCountPill count={0} />)).toBe("");
  });
});

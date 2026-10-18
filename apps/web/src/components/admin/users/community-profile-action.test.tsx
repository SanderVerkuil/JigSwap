import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { CommunityProfileAction } from "./community-profile-action";

// Router-free Link: the test asserts the rendered DOM, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children?: ReactNode;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      )}
      {...rest}
    >
      {children}
    </a>
  ),
}));

type Props = ComponentProps<typeof CommunityProfileAction>;

const render = (props: Partial<Props> = {}, locale: "en" | "nl" = "en") =>
  renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <CommunityProfileAction userId="user1" name="Mara" isActive {...props} />
    </IntlProvider>,
  );

// Assert on a real HTML tree (parse5), never on regex-extracted markup.
type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];

const isElement = (node: Node): node is Element => "tagName" in node;

const elementsOf = (html: string): Element[] => {
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

const textOf = (nodes: Node[]): string =>
  nodes
    .map((child) =>
      isElement(child)
        ? textOf(child.childNodes)
        : "value" in child
          ? child.value
          : "",
    )
    .join("");

const attr = (el: Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value;

const byTag = (html: string, tag: string) =>
  elementsOf(html).filter((el) => el.tagName === tag);

describe("CommunityProfileAction", () => {
  it("links an active member to their community profile by id", () => {
    const html = render();
    const links = byTag(html, "a");
    expect(links).toHaveLength(1);
    expect(attr(links[0]!, "href")).toBe("/members/user1");
    expect(textOf(links[0]!.childNodes)).toBe("View community profile");
    expect(byTag(html, "button")).toHaveLength(0);
  });

  it("names the member in the compact icon link's accessible text", () => {
    const links = byTag(render({ compact: true }), "a");
    expect(links).toHaveLength(1);
    expect(attr(links[0]!, "href")).toBe("/members/user1");
    expect(textOf(links[0]!.childNodes)).toBe("View Mara's community profile");
  });

  it.each([false, true])(
    "renders a disabled, explained button for an inactive member (compact=%s)",
    (compact) => {
      const html = render({ isActive: false, compact });
      expect(byTag(html, "a")).toHaveLength(0);
      expect(elementsOf(html).some((el) => attr(el, "href"))).toBe(false);
      const buttons = byTag(html, "button");
      expect(buttons).toHaveLength(1);
      expect(attr(buttons[0]!, "disabled")).toBe("");
      expect(textOf(parseFragment(html).childNodes)).toContain(
        "Deactivated members have no community profile.",
      );
    },
  );

  it("localizes the action and the explanation", () => {
    expect(textOf(byTag(render({}, "nl"), "a")[0]!.childNodes)).toBe(
      "Communityprofiel bekijken",
    );
    expect(
      textOf(parseFragment(render({ isActive: false }, "nl")).childNodes),
    ).toContain("Gedeactiveerde leden hebben geen communityprofiel.");
  });
});

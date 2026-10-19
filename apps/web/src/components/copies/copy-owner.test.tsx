import type { Id } from "@/gateway";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { CopyOwner } from "./copy-owner";

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

type Props = ComponentProps<typeof CopyOwner>;

const revealed = (member: {
  name?: string;
  username?: string;
}): Props["owner"] => ({
  anonymous: false,
  member: {
    _id: "owner1" as Id<"users">,
    _creationTime: 1,
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
    ...member,
  },
});

const anonymous: Props["owner"] = { anonymous: true, anonRef: "x1" };

const render = (props: Props, locale: "en" | "nl" = "en") =>
  renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <CopyOwner {...props} />
    </IntlProvider>,
  );

// Assert on a real HTML tree (parse5), never on regex-extracted markup.
type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];

const isElement = (node: Node): node is Element => "tagName" in node;

const parse = (html: string) => parseFragment(html).childNodes;

const elementsOf = (html: string): Element[] => {
  const out: Element[] = [];
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      out.push(node);
      walk(node.childNodes);
    }
  };
  walk(parse(html));
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

const fallback = (html: string) =>
  elementsOf(html).find((el) => attr(el, "data-slot") === "avatar-fallback")!;

const anchors = (html: string) =>
  elementsOf(html).filter((el) => el.tagName === "a");

describe("CopyOwner", () => {
  it("links a revealed owner's name to their profile by username", () => {
    const html = render({
      owner: revealed({ name: "Olivia Owner", username: "olivia" }),
      viewerIsOwner: false,
    });
    const links = anchors(html);
    expect(links).toHaveLength(1);
    expect(attr(links[0]!, "href")).toBe("/members/olivia");
    expect(textOf(links[0]!.childNodes)).toBe("Olivia Owner");
    expect(textOf(fallback(html).childNodes)).toBe("O");
  });

  it("falls back to the member id as the handle when there is no username", () => {
    const html = render({
      owner: revealed({ name: "Olivia Owner" }),
      viewerIsOwner: false,
    });
    expect(attr(anchors(html)[0]!, "href")).toBe("/members/owner1");
  });

  it("shows an anonymised owner as the anonymous label without a link", () => {
    const html = render({ owner: anonymous, viewerIsOwner: false });
    expect(anchors(html)).toHaveLength(0);
    expect(textOf(parse(html))).toBe("Anonymous user");
    // No initial: the generic person icon is rendered instead.
    expect(fallback(html).childNodes.map((n) => n.nodeName)).toEqual(["svg"]);
  });

  it('shows a departed owner as "Deleted member" without a link', () => {
    const html = render({
      owner: { anonymous: true, anonRef: "x2", departed: true },
      viewerIsOwner: false,
    });
    expect(anchors(html)).toHaveLength(0);
    expect(textOf(parse(html))).toBe("Deleted member");
  });

  it("names an anonymised housemate owner from the household view, unlinked", () => {
    const html = render({
      owner: anonymous,
      householdOwner: { memberId: "owner1", name: "Ann" },
      viewerIsOwner: false,
    });
    expect(anchors(html)).toHaveLength(0);
    expect(textOf(fallback(html).childNodes)).toBe("A");
    expect(textOf(parse(html))).toBe("AAnn");
  });

  it("marks the viewer's own copy with the localized 'you'", () => {
    const html = render(
      {
        owner: revealed({ name: "Sander", username: "sander" }),
        viewerIsOwner: true,
      },
      "nl",
    );
    expect(textOf(anchors(html)[0]!.childNodes)).toBe("Sander");
    expect(textOf(parse(html))).toContain("· jij");
  });
});

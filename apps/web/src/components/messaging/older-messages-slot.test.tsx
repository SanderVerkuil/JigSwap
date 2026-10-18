import type { PaginationStatus } from "convex/react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { OlderMessagesSlot } from "./older-messages-slot";

const render = (status: PaginationStatus, locale: "en" | "nl" = "en") =>
  renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <ol>
        <OlderMessagesSlot status={status} onLoadMore={() => {}} />
      </ol>
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
const attr = (el: Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value;
const textOf = (el: Element): string =>
  el.childNodes
    .map((n) =>
      isElement(n) ? textOf(n) : "value" in n ? (n.value as string) : "",
    )
    .join("");
const buttonOf = (html: string) =>
  elementsOf(html).find((el) => el.tagName === "button");

describe("OlderMessagesSlot", () => {
  it("offers an enabled load-earlier button when more can load", () => {
    const button = buttonOf(render("CanLoadMore"));
    expect(button && textOf(button)).toBe("Load earlier messages");
    expect(button && attr(button, "aria-disabled")).toBeUndefined();
    expect(button && attr(button, "type")).toBe("button");
  });

  it("keeps the button mounted, disabled, with a spinner while loading", () => {
    const html = render("LoadingMore");
    const button = buttonOf(html);
    expect(button && textOf(button)).toBe("Loading earlier messages…");
    expect(button && attr(button, "aria-disabled")).toBe("true");
    expect(elementsOf(html).some((el) => el.tagName === "svg")).toBe(true);
  });

  it("marks the start of the conversation once exhausted", () => {
    const html = render("Exhausted");
    expect(buttonOf(html)).toBeUndefined();
    const item = elementsOf(html).find((el) => el.tagName === "li");
    expect(item && textOf(item)).toBe("Start of the conversation");
  });

  it("renders nothing while the first page loads", () => {
    expect(
      elementsOf(render("LoadingFirstPage")).map((e) => e.tagName),
    ).toEqual(["ol"]);
  });

  it("is translated", () => {
    const button = buttonOf(render("CanLoadMore", "nl"));
    expect(button && textOf(button)).toBe("Eerdere berichten laden");
    const item = elementsOf(render("Exhausted", "nl")).find(
      (el) => el.tagName === "li",
    );
    expect(item && textOf(item)).toBe("Begin van het gesprek");
  });
});

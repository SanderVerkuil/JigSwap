import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { CircleThreadAvatar } from "../messaging/circle-thread-avatar";
import { CircleIconSectionView, type CircleIconStatus } from "./circle-icon";

const ICON = "https://example.convex.cloud/api/storage/icon";

const render = (ui: ReactElement, locale: "en" | "nl" = "en") =>
  renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      {ui}
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
      "value" in n && n.nodeName === "#text"
        ? (n as { value: string }).value
        : isElement(n)
          ? textOf(n)
          : "",
    )
    .join("");
const buttons = (html: string) =>
  elementsOf(html)
    .filter((el) => el.tagName === "button")
    .map((el) => textOf(el).trim() || attr(el, "aria-label"));

const section = (
  props: { iconUrl?: string; iconStatus?: CircleIconStatus; busy?: boolean },
  locale: "en" | "nl" = "en",
) =>
  render(
    <CircleIconSectionView
      busy={props.busy ?? false}
      iconUrl={props.iconUrl}
      iconStatus={props.iconStatus}
      onPick={() => {}}
      onRemove={() => {}}
      onDismiss={() => {}}
    />,
    locale,
  );

describe("CircleThreadAvatar with an icon", () => {
  it("shows the icon full size and keeps the circle badge", () => {
    const els = elementsOf(
      render(<CircleThreadAvatar members={[]} iconUrl={ICON} />),
    );
    const img = els.find((el) => el.tagName === "img");
    expect(img && attr(img, "src")).toBe(ICON);
    expect(img && attr(img, "alt")).toBe("");
    // The violet Users disc still marks it as a group.
    expect(els.some((el) => el.tagName === "svg")).toBe(true);
  });

  it("falls back to the circle mark without an icon", () => {
    const els = elementsOf(render(<CircleThreadAvatar members={[]} />));
    expect(els.some((el) => el.tagName === "img")).toBe(false);
    expect(els.some((el) => el.tagName === "svg")).toBe(true);
  });
});

describe("the manage dialog's Icon section", () => {
  it("offers Upload without an icon, Change and Remove with one", () => {
    expect(buttons(section({}))).toEqual(["Upload icon"]);
    expect(buttons(section({ iconUrl: ICON }))).toEqual([
      "Change icon",
      "Remove icon",
    ]);
  });

  it("tells the uploader and Admins an icon is being checked, and lets them withdraw it", () => {
    const html = section({ iconStatus: "checking" });
    const status = elementsOf(html).find((el) => attr(el, "role") === "status");
    expect(status && textOf(status)).toContain("Being checked");
    expect(buttons(html)).toEqual(["Upload icon", "Remove icon"]);
  });

  it("tells the uploader a refused icon was removed, with a dismiss", () => {
    const html = section({ iconUrl: ICON, iconStatus: "removed" });
    const status = elementsOf(html).find((el) => attr(el, "role") === "status");
    expect(status && textOf(status)).toBe(
      "The new icon was removed: our automated check flagged it.",
    );
    expect(buttons(html)).toContain("Dismiss");
  });

  it("reads in Dutch", () => {
    expect(buttons(section({ iconUrl: ICON }, "nl"))).toEqual([
      "Pictogram wijzigen",
      "Pictogram verwijderen",
    ]);
  });
});

import type { ConnectionOfferView } from "@jigswap/contracts";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { ConnectionOfferList } from "./connection-offers";

const noop = () => {};

const offer = (from: ConnectionOfferView["from"]): ConnectionOfferView => ({
  offerId: "offer-1",
  from,
  source: "inviteLink",
  createdAt: 0,
});

const ann = offer({ memberId: "u1", displayName: "Ann", username: "ann" });

const render = (
  offers: ConnectionOfferView[],
  locale: "en" | "nl" = "en",
  busy = false,
) =>
  renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <ConnectionOfferList
        offers={offers}
        busy={busy}
        onAccept={noop}
        onDecline={noop}
      />
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
const textOf = (el: Element): string =>
  el.childNodes
    .map((n) =>
      "value" in n && n.nodeName === "#text"
        ? n.value
        : isElement(n)
          ? textOf(n)
          : "",
    )
    .join("");
const byTag = (html: string, tag: string) =>
  elementsOf(html).filter((el) => el.tagName === tag);

describe("ConnectionOfferList", () => {
  it("names the inviter and asks to follow each other, with both answers", () => {
    const html = render([ann]);
    expect(byTag(html, "p").map(textOf)).toEqual([
      "Ann invited you to JigSwap. Follow each other?",
    ]);
    expect(byTag(html, "button").map(textOf)).toEqual([
      "Follow each other",
      "Not now",
    ]);
  });

  it("is localised in Dutch", () => {
    const html = render([ann], "nl");
    expect(byTag(html, "p").map(textOf)).toEqual([
      "Ann heeft je uitgenodigd voor JigSwap. Elkaar volgen?",
    ]);
    expect(byTag(html, "button").map(textOf)).toEqual([
      "Elkaar volgen",
      "Niet nu",
    ]);
  });

  it("uses the generic member label for an inviter without a display name", () => {
    const html = render([offer({ memberId: "u2" })]);
    expect(byTag(html, "p").map(textOf)).toEqual([
      "Puzzler invited you to JigSwap. Follow each other?",
    ]);
  });

  it("disables both answers while one is in flight", () => {
    const html = render([ann], "en", true);
    expect(
      byTag(html, "button").every((b) =>
        b.attrs.some((a) => a.name === "disabled"),
      ),
    ).toBe(true);
  });
});

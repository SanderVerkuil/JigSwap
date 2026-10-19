import type { HouseholdLinkJoinRequestState } from "@jigswap/contracts";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  HouseholdLinkInviteCard,
  type HouseholdLinkState,
} from "./household-link-invite";

const noop = () => {};

const render = (
  state: HouseholdLinkState,
  locale: "en" | "nl" = "en",
  busy = false,
  joinRequest?: HouseholdLinkJoinRequestState,
) =>
  renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <HouseholdLinkInviteCard
        state={state}
        inviterName="Ann"
        busy={busy}
        onAccept={noop}
        onDecline={noop}
        joinRequest={joinRequest}
        onAskToJoin={noop}
        onWithdraw={noop}
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
const buttons = (html: string) =>
  elementsOf(html).filter((el) => el.tagName === "button");
const attr = (el: Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value;
const headings = (html: string) =>
  elementsOf(html)
    .filter((el) => el.tagName === "h2")
    .map(textOf);
const paragraphs = (html: string) =>
  elementsOf(html)
    .filter((el) => el.tagName === "p")
    .map(textOf);

describe("HouseholdLinkInviteCard", () => {
  it("can-accept: names the inviter and offers Accept and Decline", () => {
    const html = render("can-accept");
    expect(headings(html)).toEqual(["Ann invited you to their household"]);
    expect(buttons(html).map(textOf)).toEqual(["Accept", "Decline"]);
    expect(buttons(html).every((b) => attr(b, "disabled") === undefined)).toBe(
      true,
    );
    const section = elementsOf(html).find((el) => el.tagName === "section");
    expect(section && attr(section, "aria-labelledby")).toBeDefined();
  });

  it("can-accept: disables both buttons while a response is in flight", () => {
    const html = render("can-accept", "en", true);
    expect(buttons(html).every((b) => attr(b, "disabled") !== undefined)).toBe(
      true,
    );
  });

  it("already-in-household: says why and offers Leave and join or Decline", () => {
    const html = render("already-in-household");
    expect(headings(html)).toEqual(["Ann invited you to their household"]);
    expect(paragraphs(html).join(" ")).toContain(
      "You're already in a household",
    );
    expect(buttons(html).map(textOf)).toEqual(["Leave and join", "Decline"]);
  });

  it.each([
    ["expired", "This invite link has expired. Ask Ann for a new one."],
    ["used", "This invite link was already used. Ask Ann for a new one."],
    ["invalid", "This invite link is no longer valid."],
  ] as const)("%s: a notice without actions", (state, text) => {
    const html = render(state);
    expect(paragraphs(html)).toEqual([text]);
    expect(headings(html)).toEqual([]);
    expect(buttons(html)).toEqual([]);
  });

  it("own-link: renders nothing", () => {
    expect(render("own-link")).toBe("");
  });

  it("renders in Dutch", () => {
    const html = render("can-accept", "nl");
    expect(headings(html)).toEqual([
      "Ann heeft je uitgenodigd voor hun huishouden",
    ]);
    expect(buttons(html).map(textOf)).toEqual(["Accepteren", "Weigeren"]);
  });
});

describe("HouseholdLinkInviteCard: asking to join", () => {
  const buttons = (html: string) =>
    elementsOf(html)
      .filter((e) => e.tagName === "button")
      .map(textOf);
  const texts = (html: string) => elementsOf(html).map(textOf);

  it("offers Ask to join on an expired or used link the member hasn't asked on", () => {
    for (const state of ["expired", "used"] as const) {
      const html = render(state, "en", false, { status: "none" });
      expect(buttons(html)).toEqual(["Ask to join"]);
      expect(texts(html).join(" ")).toContain(
        "You can still ask Ann to let you in.",
      );
    }
  });

  it("shows a pending request as waiting, with Withdraw", () => {
    const html = render("expired", "en", false, {
      status: "pending",
      requestId: "r1",
      expiresAt: 1,
    });
    expect(texts(html)).toContain(
      "You asked Ann to let you into their household",
    );
    expect(buttons(html)).toEqual(["Withdraw request"]);
  });

  it("offers nothing once the member's one request for this link is used up", () => {
    const html = render("used", "en", false, { status: "closed" });
    expect(buttons(html)).toEqual([]);
    expect(texts(html).join(" ")).toContain("Ask Ann for a new one.");
  });

  it("never offers a request on an invalid link", () => {
    expect(buttons(render("invalid", "en", false, undefined))).toEqual([]);
  });

  it("tells a member of the link's household that they're already in it", () => {
    const html = render("own-household");
    expect(texts(html)).toContain("You're already in this household.");
    expect(buttons(html)).toEqual([]);
  });
});

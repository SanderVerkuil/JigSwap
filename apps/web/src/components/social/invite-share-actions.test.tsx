import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { InviteShareActions, InviteShareButtons } from "./invite-share-actions";

const URL_ = "https://jigswap.app/members/m1?invite=abc";

const render = (node: ReactNode, locale: "en" | "nl" = "en") =>
  renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      {node}
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
        ? n.value
        : isElement(n)
          ? textOf(n)
          : "",
    )
    .join("");

const controls = (html: string) =>
  elementsOf(html).filter(
    (el) => el.tagName === "button" || el.tagName === "a",
  );
const labels = (html: string) => controls(html).map(textOf);
const byLabel = (html: string, label: string) =>
  controls(html).find((el) => textOf(el) === label);

describe("InviteShareButtons", () => {
  it("offers the Web Share button first when navigator.share exists", () => {
    const html = render(
      <InviteShareButtons url={URL_} kind="network" canShare />,
    );
    expect(labels(html)).toEqual([
      "Share invite link",
      "Copy link",
      "Email",
      "WhatsApp",
    ]);
  });

  it("falls back to copy, Email and WhatsApp without navigator.share", () => {
    const html = render(
      <InviteShareButtons url={URL_} kind="network" canShare={false} />,
    );
    expect(labels(html)).toEqual(["Copy link", "Email", "WhatsApp"]);
  });

  it("prefills mailto and WhatsApp with the message and no recipient", () => {
    const html = render(
      <InviteShareButtons url={URL_} kind="network" canShare={false} />,
    );
    const mail = new URL(attr(byLabel(html, "Email")!, "href")!);
    expect(mail.protocol).toBe("mailto:");
    expect(mail.pathname).toBe("");
    expect(mail.searchParams.get("subject")).toBe("Join me on JigSwap");
    expect(mail.searchParams.get("body")).toBe(
      `Join me on JigSwap, where I keep track of my puzzles: ${URL_}`,
    );

    const wa = byLabel(html, "WhatsApp")!;
    const waUrl = new URL(attr(wa, "href")!);
    expect(waUrl.origin + waUrl.pathname).toBe("https://wa.me/");
    expect(waUrl.searchParams.get("text")).toContain(URL_);
    expect(attr(wa, "target")).toBe("_blank");
    expect(attr(wa, "rel")).toBe("noopener noreferrer");
  });

  it("uses the household message for a household link", () => {
    const html = render(
      <InviteShareButtons url={URL_} kind="household" canShare={false} />,
    );
    const wa = new URL(attr(byLabel(html, "WhatsApp")!, "href")!);
    expect(wa.searchParams.get("text")).toBe(
      `Join our household on JigSwap so we can share one puzzle shelf: ${URL_}`,
    );
  });

  it("says JigSwap doesn't see the recipient, and has a live region for Copied!", () => {
    const html = render(
      <InviteShareButtons url={URL_} kind="network" canShare={false} />,
    );
    const els = elementsOf(html);
    expect(els.map(textOf)).toContain(
      "JigSwap doesn't see or store who you send this to.",
    );
    const status = els.find((el) => attr(el, "role") === "status");
    expect(status && attr(status, "aria-live")).toBe("polite");
  });

  it("disables every action while the link is loading", () => {
    const html = render(
      <InviteShareButtons url={null} kind="network" canShare />,
    );
    const all = controls(html);
    expect(all.map((el) => el.tagName)).toEqual([
      "button",
      "button",
      "button",
      "button",
    ]);
    expect(all.every((el) => attr(el, "disabled") !== undefined)).toBe(true);
  });

  it("puts the Dutch fallback labels in a wrapping row with touch-size targets", () => {
    const html = render(
      <InviteShareButtons url={URL_} kind="network" canShare />,
      "nl",
    );
    expect(labels(html)).toEqual([
      "Uitnodigingslink delen",
      "Link kopiëren",
      "E-mail",
      "WhatsApp",
    ]);
    // At 328 px "Link kopiëren · E-mail · WhatsApp" does not fit on one line: the row wraps.
    const els = elementsOf(html);
    const fallbacks = els
      .filter((el) => el.tagName === "button" || el.tagName === "a")
      .slice(1);
    const row = els.find((el) =>
      fallbacks.every((c) => el.childNodes.includes(c)),
    );
    expect(attr(row!, "class")?.split(" ")).toEqual(
      expect.arrayContaining(["flex", "flex-wrap", "gap-2"]),
    );
    for (const c of controls(html)) {
      expect(attr(c, "class")).toContain("pointer-coarse:min-h-11");
    }
    // The share button spans the column on phones.
    expect(attr(controls(html)[0], "class")).toContain("w-full");
  });
});

describe("InviteShareActions", () => {
  it("renders no Web Share button on the server (no hydration mismatch)", () => {
    const html = render(<InviteShareActions url={URL_} kind="network" />);
    expect(labels(html)).toEqual(["Copy link", "Email", "WhatsApp"]);
  });
});

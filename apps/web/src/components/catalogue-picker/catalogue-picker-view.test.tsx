import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  CataloguePickerView,
  type CataloguePickerViewProps,
} from "./catalogue-picker-view";
import { PICK_LIMIT, type Pick, type PickerRow } from "./selection";

// Router-free Link: the test asserts the DOM, not routing. The search object is serialised the
// way the router would, so the register link's href is checkable.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string;
    search?: Record<string, string | undefined>;
    children?: ReactNode;
  }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search ?? {})) {
      if (value !== undefined) params.set(key, value);
    }
    const query = params.toString();
    return (
      <a href={query ? `${to}?${query}` : to} {...rest}>
        {children}
      </a>
    );
  },
}));

type Element = DefaultTreeAdapterMap["element"];
type Node = DefaultTreeAdapterMap["childNode"];

const elements = (root: { childNodes: Node[] }): Element[] =>
  root.childNodes.flatMap((node) =>
    "tagName" in node ? [node, ...elements(node)] : [],
  );
const attr = (el: Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value;
const text = (node: { childNodes?: Node[] }): string =>
  (node.childNodes ?? [])
    .map((child) =>
      child.nodeName === "#text"
        ? (child as DefaultTreeAdapterMap["textNode"]).value
        : text(child as Element),
    )
    .join("");

const row = (
  definitionId: string,
  extra: Partial<PickerRow> = {},
): PickerRow => ({
  definitionId,
  title: `Puzzle ${definitionId}`,
  brand: "Ravensburger",
  pieceCount: 1000,
  image: null,
  pending: false,
  onShelf: false,
  ...extra,
});
const pick = (definitionId: string, extra: Partial<Pick> = {}): Pick => ({
  definitionId,
  title: `Puzzle ${definitionId}`,
  pending: false,
  forTrade: false,
  ...extra,
});

const noop = () => {};
const render = (
  props: Partial<CataloguePickerViewProps>,
  locale: "en" | "nl" = "en",
) => {
  const html = renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <CataloguePickerView
        term=""
        rows={[]}
        picks={[]}
        isSearching={false}
        isSubmitting={false}
        onTermChange={noop}
        onToggle={noop}
        onRemove={noop}
        onRemoveLast={noop}
        onForTradeChange={noop}
        onSubmit={noop}
        {...props}
      />
    </IntlProvider>,
  );
  return elements(parseFragment(html));
};

const buttons = (els: Element[]) => els.filter((el) => el.tagName === "button");
const byLabel = (els: Element[], label: string) =>
  els.filter((el) => attr(el, "aria-label") === label);

describe("CataloguePickerView", () => {
  it("renders each result as an aria-pressed toggle named Add/Remove", () => {
    const els = render({
      term: "puzzle",
      rows: [row("a"), row("b")],
      picks: [pick("b")],
    });
    const [addA] = byLabel(els, "Add Puzzle a");
    const [removeB] = byLabel(buttons(els), "Remove Puzzle b");
    expect(attr(addA, "aria-pressed")).toBe("false");
    expect(attr(removeB, "aria-pressed")).toBe("true");
  });

  it("marks own pending submissions and copies already on the shelf", () => {
    const els = render({
      term: "puzzle",
      rows: [row("a", { pending: true }), row("b", { onShelf: true })],
    });
    const [addA] = byLabel(els, "Add Puzzle a");
    const [addB] = byLabel(els, "Add Puzzle b");
    expect(text(addA)).toContain("Pending review");
    expect(text(addA)).not.toContain("On your shelf");
    expect(text(addB)).toContain("On your shelf");
  });

  it("announces the pick count in a polite live region", () => {
    const els = render({ picks: [pick("a"), pick("b"), pick("c")] });
    const live = els.find((el) => attr(el, "aria-live") === "polite");
    expect(live && text(live)).toBe("3 picked");
  });

  it("gives each picked row a swap switch and a remove button named after the puzzle", () => {
    const els = render({ picks: [pick("a"), pick("b", { forTrade: true })] });
    const [switchA] = byLabel(els, "Puzzle a available to swap");
    const [switchB] = byLabel(els, "Puzzle b available to swap");
    expect(attr(switchA, "role")).toBe("switch");
    expect(attr(switchA, "aria-checked")).toBe("false");
    expect(attr(switchB, "aria-checked")).toBe("true");
    expect(byLabel(buttons(els), "Remove Puzzle a")).toHaveLength(1);
  });

  it("labels the submit with the count and disables it on an empty tray", () => {
    const submit = (els: Element[]) =>
      buttons(els).find((el) => attr(el, "data-picker-submit") !== undefined)!;

    const empty = submit(render({}));
    expect(attr(empty, "disabled")).toBeDefined();

    const two = submit(render({ picks: [pick("a"), pick("b")] }));
    expect(text(two)).toBe("Add 2 puzzles");
    expect(attr(two, "disabled")).toBeUndefined();

    const busy = submit(render({ picks: [pick("a")], isSubmitting: true }));
    expect(attr(busy, "disabled")).toBeDefined();
  });

  it("links 'Register' to the full form with the query and returnTo", () => {
    const els = render({
      term: "Cats at night",
      returnTo: "/welcome?step=puzzles",
    });
    const link = els.find((el) => el.tagName === "a")!;
    expect(text(link)).toContain('Register "Cats at night"');
    expect(attr(link, "href")).toBe(
      "/my-puzzles/add/new?title=Cats+at+night&returnTo=%2Fwelcome%3Fstep%3Dpuzzles",
    );
  });

  it("says when nothing matches the query", () => {
    const els = render({ term: "zzz", rows: [] });
    expect(els.some((el) => text(el) === 'No puzzles match "zzz".')).toBe(true);
  });

  it("disables unpicked rows once the tray is full", () => {
    const full = Array.from({ length: PICK_LIMIT }, (_, i) => pick(`p${i}`));
    const els = render({
      term: "puzzle",
      rows: [row("x"), row("p0")],
      picks: full,
    });
    expect(attr(byLabel(els, "Add Puzzle x")[0], "disabled")).toBeDefined();
    expect(
      attr(byLabel(buttons(els), "Remove Puzzle p0")[0], "disabled"),
    ).toBeUndefined();
    expect(
      els.some((el) => text(el) === "You can add up to 25 puzzles at once."),
    ).toBe(true);
  });

  it("states that added puzzles are not offered by default, in Dutch too", () => {
    const els = render({}, "nl");
    expect(
      els.some((el) =>
        text(el).startsWith("Toegevoegde puzzels worden niet aangeboden"),
      ),
    ).toBe(true);
    const submit = buttons(els).find(
      (el) => attr(el, "data-picker-submit") !== undefined,
    )!;
    expect(text(submit)).toBe("0 puzzels toevoegen");
  });
});

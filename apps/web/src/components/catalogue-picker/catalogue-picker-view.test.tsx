// @vitest-environment happy-dom
import { isSurfaceBusy } from "@/components/whats-new/surface-busy";
import {
  cleanup,
  fireEvent,
  render as renderDom,
  screen,
} from "@testing-library/react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  forLend: false,
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
        onForLendChange={noop}
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
  it("lets a thumbnail pick a rendition for its 40px tile, and shows a lone URL as it is", () => {
    const els = render({
      term: "puzzle",
      rows: [
        row("a", {
          image: "https://files.example/a",
          imageSrcSet:
            "https://files.example/a-480 480w, https://files.example/a 1600w",
        }),
        row("b", { image: "https://files.example/b" }),
      ],
    });
    const [withSet, alone] = els.filter((el) => el.tagName === "img");
    expect(attr(withSet, "src")).toBe("https://files.example/a");
    expect(attr(withSet, "srcset")).toBe(
      "https://files.example/a-480 480w, https://files.example/a 1600w",
    );
    expect(attr(withSet, "sizes")).toBe("40px");
    expect(attr(alone, "src")).toBe("https://files.example/b");
    expect(attr(alone, "srcset")).toBeUndefined();
    expect(attr(alone, "sizes")).toBeUndefined();
  });

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

  // The tint alone is a faint fill: a picked row also carries a Canal Link edge.
  it("edges a picked row as well as tinting it", () => {
    const els = render({
      term: "puzzle",
      rows: [row("a"), row("b")],
      picks: [pick("b")],
    });
    const classes = (el: Element) => attr(el, "class")?.split(" ") ?? [];
    const [addA] = byLabel(els, "Add Puzzle a");
    const [removeB] = byLabel(buttons(els), "Remove Puzzle b");
    expect(classes(removeB)).toEqual(
      expect.arrayContaining([
        "bg-jigsaw-primary-tint",
        "ring-1",
        "ring-inset",
        "ring-primary-text",
      ]),
    );
    expect(classes(addA)).not.toContain("ring-primary-text");
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

  it("gives each picked row swap and lend switches and a remove button named after the puzzle", () => {
    const els = render({
      picks: [pick("a"), pick("b", { forTrade: true, forLend: true })],
    });
    const [switchA] = byLabel(els, "Puzzle a available to swap");
    const [switchB] = byLabel(els, "Puzzle b available to swap");
    expect(attr(switchA, "role")).toBe("switch");
    expect(attr(switchA, "aria-checked")).toBe("false");
    expect(attr(switchB, "aria-checked")).toBe("true");
    const [lendA] = byLabel(els, "Puzzle a available to lend");
    const [lendB] = byLabel(els, "Puzzle b available to lend");
    expect(attr(lendA, "aria-checked")).toBe("false");
    expect(attr(lendB, "aria-checked")).toBe("true");
    expect(byLabel(buttons(els), "Remove Puzzle a")).toHaveLength(1);
  });

  it("labels the submit with the count, and has none on an empty tray (never 'Add 0')", () => {
    const submit = (els: Element[]) =>
      buttons(els).find((el) => attr(el, "data-picker-submit") !== undefined);

    expect(submit(render({}))).toBeUndefined();

    const two = submit(render({ picks: [pick("a"), pick("b")] }))!;
    expect(text(two)).toBe("Add 2 puzzles");
    expect(attr(two, "disabled")).toBeUndefined();

    const busy = submit(render({ picks: [pick("a")], isSubmitting: true }))!;
    expect(attr(busy, "disabled")).toBeDefined();
  });

  it("hides its submit inside quick setup, where Continue adds the picks", () => {
    const els = render({ picks: [pick("a"), pick("b")], hideSubmit: true });
    expect(
      buttons(els).some((el) => attr(el, "data-picker-submit") !== undefined),
    ).toBe(false);
    expect(buttons(els).some((el) => text(el).startsWith("Add 2"))).toBe(false);
    // The tray stays: the picks are still listed and editable.
    expect(byLabel(buttons(els), "Remove Puzzle a")).toHaveLength(1);
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

  it("asks to keep typing a partial barcode instead of saying nothing matches", () => {
    const els = render({ term: "8710126", rows: [] });
    expect(
      els.some(
        (el) =>
          text(el) ===
          "Keep typing the barcode… Barcodes on puzzle boxes have 12 or 13 digits.",
      ),
    ).toBe(true);
    expect(els.some((el) => text(el).startsWith("No puzzles match"))).toBe(
      false,
    );
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
      els.some((el) => text(el) === "You can add up to 100 puzzles at once."),
    ).toBe(true);
  });

  it("says how to offer a pick for swap, after picking it", () => {
    const els = render({});
    expect(
      els.some(
        (el) =>
          text(el) ===
          "Added puzzles aren't offered for swap or loan unless you switch that on here. You can change it per puzzle later.",
      ),
    ).toBe(true);
  });

  it("states that added puzzles are not offered by default, in Dutch too", () => {
    const els = render({ picks: [pick("a")] }, "nl");
    expect(
      els.some((el) =>
        text(el).startsWith("Toegevoegde puzzels worden niet aangeboden"),
      ),
    ).toBe(true);
    const submit = buttons(els).find(
      (el) => attr(el, "data-picker-submit") !== undefined,
    )!;
    expect(text(submit)).toBe("1 puzzel toevoegen");
  });

  // The piece count follows the app locale, like every other number (UX-63).
  it.each([
    ["en", "1,000 pieces"],
    ["nl", "1.000 stukjes"],
  ] as const)("formats a row's piece count in %s", (locale, expected) => {
    const els = render({ term: "puzzle", rows: [row("a")] }, locale);
    const label = locale === "en" ? "Add Puzzle a" : "Puzzle a toevoegen";
    const [addA] = byLabel(els, label);
    expect(text(addA)).toContain(expected);
  });
});

// The quick-add page docks the submit on phones (stickyFooter); /welcome has its own flow footer.
describe("CataloguePickerView stickyFooter", () => {
  afterEach(cleanup);

  const classOf = (els: Element[], predicate: (el: Element) => boolean) =>
    attr(els.find(predicate)!, "class") ?? "";
  const toggle = (els: Element[]) =>
    buttons(els).find((el) => attr(el, "aria-expanded") !== undefined);
  const footer = (els: Element[]) =>
    els.find((el) => attr(el, "data-picker-footer") !== undefined);

  it("docks the submit and a 'Picked (n)' tray toggle above the tab bar on phones", () => {
    const els = render({ stickyFooter: true, picks: [pick("a"), pick("b")] });
    const chip = toggle(els)!;
    expect(text(chip)).toBe("Picked (2)");
    expect(attr(chip, "aria-expanded")).toBe("false");
    expect(attr(chip, "class")).toContain("sm:hidden");
    const tray = els.find(
      (el) => attr(el, "id") === attr(chip, "aria-controls"),
    );
    expect(tray?.tagName).toBe("section");
    expect(attr(tray!, "class")).toContain("max-sm:hidden");
    const dock = attr(footer(els)!, "class");
    expect(dock).toContain("max-sm:sticky");
    expect(dock).toContain("max-sm:bottom-14");
  });

  it("stays in the flow while nothing is picked", () => {
    const els = render({ stickyFooter: true });
    expect(toggle(els)).toBeUndefined();
    expect(attr(footer(els)!, "class")).not.toContain("sticky");
  });

  it("never docks without the prop (the /welcome flow has its own footer)", () => {
    const els = render({ picks: [pick("a")] });
    expect(toggle(els)).toBeUndefined();
    expect(attr(footer(els)!, "class")).not.toContain("sticky");
    expect(classOf(els, (el) => el.tagName === "section")).not.toContain(
      "max-sm:hidden",
    );
  });

  it("reports the bottom of the screen as taken only while docked, so the install tip steps aside", () => {
    const view = (picks: Pick[]) => (
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <CataloguePickerView
          term=""
          rows={[]}
          picks={picks}
          isSearching={false}
          isSubmitting={false}
          stickyFooter
          onTermChange={noop}
          onToggle={noop}
          onRemove={noop}
          onRemoveLast={noop}
          onForTradeChange={noop}
          onForLendChange={noop}
          onSubmit={noop}
        />
      </IntlProvider>
    );
    const { rerender } = renderDom(view([]));
    expect(isSurfaceBusy()).toBe(false);
    rerender(view([pick("a")]));
    expect(isSurfaceBusy()).toBe(true);
    rerender(view([]));
    expect(isSurfaceBusy()).toBe(false);
  });

  it("opens and closes the tray from the chip", () => {
    renderDom(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <CataloguePickerView
          term=""
          rows={[]}
          picks={[pick("a"), pick("b"), pick("c")]}
          isSearching={false}
          isSubmitting={false}
          stickyFooter
          onTermChange={noop}
          onToggle={noop}
          onRemove={noop}
          onRemoveLast={noop}
          onForTradeChange={noop}
          onForLendChange={noop}
          onSubmit={noop}
        />
      </IntlProvider>,
    );
    const chip = screen.getByRole("button", { name: "Picked (3)" });
    const tray = document.getElementById(chip.getAttribute("aria-controls")!)!;
    expect(tray.className).toContain("max-sm:hidden");

    fireEvent.click(chip);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    expect(tray.className).not.toContain("max-sm:hidden");

    fireEvent.click(chip);
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(tray.className).toContain("max-sm:hidden");
  });
});

import type { PastSolveChoice } from "@/lib/past-solves";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { PastSolveRow, PastSolvesList } from "./past-solves-form";

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
    .map((child) =>
      isElement(child) ? textOf(child) : "value" in child ? child.value : "",
    )
    .join("");

// Radix renders a hidden native checkbox next to its button; only the date input matters here.
const isDateInput = (el: Element) =>
  el.tagName === "input" && attr(el, "type") === "date";

const noop = () => {};
const row = (choice: PastSolveChoice | undefined, disabled = false) =>
  render(
    <PastSolveRow
      id="copy-1"
      title="Mountain Lake"
      choice={choice}
      disabled={disabled}
      years={[2026, 2025, 2024]}
      maxDate="2026-10-17"
      onChange={noop}
    />,
  );

describe("PastSolveRow", () => {
  it("is an unticked 'I finished <title>' checkbox with its label, and no 'When?' yet", () => {
    const els = elementsOf(row(undefined));
    const checkbox = els.find((el) => attr(el, "role") === "checkbox");
    expect(checkbox).toBeDefined();
    expect(attr(checkbox!, "aria-checked")).toBe("false");
    const label = els.find((el) => el.tagName === "label");
    expect(attr(label!, "for")).toBe(attr(checkbox!, "id"));
    expect(textOf(label!)).toBe("I finished Mountain Lake");
    expect(els.some((el) => attr(el, "role") === "radiogroup")).toBe(false);
  });

  it("disables an unticked row when the batch is full", () => {
    const checkbox = elementsOf(row(undefined, true)).find(
      (el) => attr(el, "role") === "checkbox",
    );
    expect(checkbox!.attrs.some((a) => a.name === "disabled")).toBe(true);
  });

  it("asks 'When?' once ticked, with 'I don't remember' selected and no date inputs", () => {
    const els = elementsOf(row({ when: "unknown", year: 2026, date: "" }));
    const group = els.find((el) => attr(el, "role") === "radiogroup");
    expect(attr(group!, "aria-label")).toBe("When?");
    const radios = els.filter((el) => attr(el, "role") === "radio");
    expect(radios.map(textOf)).toEqual([
      "I don't remember",
      "Which year",
      "Pick a date",
    ]);
    expect(radios.map((r) => attr(r, "aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(els.some((el) => el.tagName === "select")).toBe(false);
    expect(els.some(isDateInput)).toBe(false);
  });

  it("shows a year select for 'Which year'", () => {
    const els = elementsOf(row({ when: "year", year: 2025, date: "" }));
    const select = els.find((el) => el.tagName === "select");
    expect(attr(select!, "aria-label")).toBe("Which year");
    const options = els.filter((el) => el.tagName === "option");
    expect(options.map(textOf)).toEqual(["2026", "2025", "2024"]);
    const selected = options.find((o) =>
      o.attrs.some((a) => a.name === "selected"),
    );
    expect(textOf(selected!)).toBe("2025");
  });

  it("shows a date input capped at today for 'Pick a date'", () => {
    const els = elementsOf(
      row({ when: "day", year: 2026, date: "2026-03-14" }),
    );
    const input = els.find(isDateInput);
    expect(attr(input!, "type")).toBe("date");
    expect(attr(input!, "max")).toBe("2026-10-17");
    expect(attr(input!, "value")).toBe("2026-03-14");
    expect(attr(input!, "aria-label")).toBe("Pick a date");
  });
});

describe("PastSolvesList", () => {
  const submit = async () => true;

  it("leads with the question, lists every candidate and starts with a disabled submit", () => {
    const els = elementsOf(
      render(
        <PastSolvesList
          candidates={[
            { copyId: "a", title: "Mountain Lake" },
            { copyId: "b", title: "Cats" },
          ]}
          pending={false}
          onSubmit={submit}
        />,
      ),
    );
    expect(
      els.some((el) => textOf(el) === "Did you finish any of these?"),
    ).toBe(true);
    const labels = els.filter((el) => el.tagName === "label").map(textOf);
    expect(labels).toEqual(["I finished Mountain Lake", "I finished Cats"]);
    const buttons = els.filter(
      (el) => el.tagName === "button" && !attr(el, "role"),
    );
    const submitButton = buttons.at(-1)!;
    expect(textOf(submitButton)).toBe("Log 0 puzzles");
    expect(submitButton.attrs.some((a) => a.name === "disabled")).toBe(true);
  });

  it("caps the first page at 25 rows with 'Show more'", () => {
    const candidates = Array.from({ length: 30 }, (_, i) => ({
      copyId: `c${i}`,
      title: `Puzzle ${i}`,
    }));
    const els = elementsOf(
      render(
        <PastSolvesList
          candidates={candidates}
          pending={false}
          onSubmit={submit}
        />,
      ),
    );
    expect(els.filter((el) => el.tagName === "li")).toHaveLength(25);
    expect(
      els.some((el) => el.tagName === "button" && textOf(el) === "Show more"),
    ).toBe(true);
  });

  it("shows the empty state with the caller's action when there is nothing to log", () => {
    const els = elementsOf(
      render(
        <PastSolvesList
          candidates={[]}
          pending={false}
          onSubmit={submit}
          emptyAction={<a href="/welcome?step=puzzles">Add puzzles</a>}
        />,
        "nl",
      ),
    );
    expect(
      els.some(
        (el) =>
          textOf(el) ===
          "Voeg eerst een puzzel toe en kom dan terug om hem vast te leggen.",
      ),
    ).toBe(true);
    expect(
      attr(
        els.find((el) => el.tagName === "a")!,
        "href",
      ),
    ).toBe("/welcome?step=puzzles");
  });
});

describe("quickStart.solves locale keys", () => {
  it("exist in nl with the same keys as en", () => {
    expect(Object.keys(nl.quickStart.solves)).toEqual(
      Object.keys(en.quickStart.solves),
    );
  });
});

// @vitest-environment happy-dom
import {
  createStepCommitStore,
  StepCommitContext,
  type StepCommitStore,
} from "@/components/quick-start/step-commit";
import type { PastCompletionItem, PastSolveChoice } from "@/lib/past-solves";
import {
  act,
  cleanup,
  fireEvent,
  render as renderDom,
  screen,
} from "@testing-library/react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { PastSolveRow, PastSolvesList } from "./past-solves-form";

afterEach(cleanup);

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

  it("leads with the question, lists every candidate and never offers to log 0", () => {
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
    // Nothing ticked: no submit at all, so never "Log 0 puzzles".
    const buttons = els.filter(
      (el) => el.tagName === "button" && !attr(el, "role"),
    );
    expect(buttons).toEqual([]);
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

  it("says what the caller gives it when there is nothing to log", () => {
    const els = elementsOf(
      render(
        <PastSolvesList
          candidates={[]}
          pending={false}
          onSubmit={submit}
          emptyText="Nothing left."
        />,
      ),
    );
    expect(els.some((el) => textOf(el) === "Nothing left.")).toBe(true);
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

// Ticking happens in the DOM (Radix checkbox), so these render with Testing Library.
describe("PastSolvesList (ticking)", () => {
  const CANDIDATES = [
    { copyId: "a", title: "Mountain Lake" },
    { copyId: "b", title: "Cats" },
  ];
  const list = (
    onSubmit: (items: PastCompletionItem[]) => Promise<boolean>,
    store?: StepCommitStore,
  ) => {
    const ui = (
      <PastSolvesList
        candidates={CANDIDATES}
        pending={false}
        onSubmit={onSubmit}
      />
    );
    return renderDom(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        {store ? <StepCommitContext value={store}>{ui}</StepCommitContext> : ui}
      </IntlProvider>,
    );
  };
  const tick = (title: string) =>
    act(() => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: `I finished ${title}` }),
      );
    });

  it("shows its own submit with the count once something is ticked", () => {
    list(async () => true);
    tick("Cats");
    expect(screen.getByRole("button", { name: "Log 1 puzzle" })).toBeTruthy();
  });

  it("inside quick setup hides its submit and hands the ticks to Continue", async () => {
    const store = createStepCommitStore();
    const onSubmit = vi.fn(async () => true);
    list(onSubmit, store);
    tick("Mountain Lake");
    tick("Cats");
    expect(screen.queryByRole("button", { name: /^Log / })).toBeNull();
    expect(store.getSnapshot()).toEqual({
      kind: "solves",
      count: 2,
      ready: true,
    });

    // "Pick a date" without a date can't be saved yet.
    act(() => {
      fireEvent.click(
        screen.getAllByRole("radio", { name: "Pick a date" })[0]!,
      );
    });
    expect(store.getSnapshot()?.ready).toBe(false);
    act(() => {
      fireEvent.click(
        screen.getAllByRole("radio", { name: "I don't remember" })[0]!,
      );
    });
    expect(store.getSnapshot()?.ready).toBe(true);

    let saved: boolean | undefined;
    await act(async () => {
      saved = await store.commit();
    });
    expect(saved).toBe(true);
    expect(onSubmit).toHaveBeenCalledWith([
      { copyId: "a", datePrecision: "unknown" },
      { copyId: "b", datePrecision: "unknown" },
    ]);
    // Logged rows clear, so nothing is pending any more.
    expect(store.getSnapshot()?.count).toBe(0);
  });

  it("says the batch limit at the cap, and stops the other rows", () => {
    const candidates = Array.from({ length: 26 }, (_, i) => ({
      copyId: `c${i}`,
      title: `Puzzle ${i}`,
    }));
    renderDom(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <PastSolvesList
          candidates={candidates}
          pending={false}
          onSubmit={async () => true}
        />
      </IntlProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    const message =
      "25 is the most for one batch. Log these first, then mark the rest.";
    for (let i = 0; i < 24; i++) tick(`Puzzle ${i}`);
    expect(screen.queryByText(message)).toBeNull();
    tick("Puzzle 24");
    expect(screen.getByRole("status").textContent).toBe(message);
    expect(
      screen
        .getByRole("checkbox", { name: "I finished Puzzle 25" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Log 25 puzzles" })).toBeTruthy();
  });

  it("refuses a typed date after today, next to the row, with nothing to submit", () => {
    list(async () => true);
    tick("Cats");
    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: "Pick a date" }));
    });
    act(() => {
      fireEvent.change(screen.getByLabelText("Pick a date"), {
        target: { value: "2999-01-01" },
      });
    });
    expect(screen.getByText("Pick a date up to today.")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Log 1 puzzle" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("links a refused date to its reason, and a valid date to nothing", () => {
    list(async () => true);
    tick("Cats");
    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: "Pick a date" }));
    });
    const input = screen.getByLabelText("Pick a date");
    act(() => {
      fireEvent.change(input, { target: { value: "2999-01-01" } });
    });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(
      screen.getByText("Pick a date up to today.").id,
    );
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    act(() => {
      fireEvent.change(input, { target: { value: "2020-01-01" } });
    });
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
  });

  // The room a browser leaves when focus scrolls: at its tallest, with the two-line cap message, the
  // bar is 135px on a phone (above the tab bar) and 97px on a tablet. Its own button stays out of
  // this, or tabbing to a bar already on screen would scroll the page.
  it("keeps a focused row control clear of the sticky bars", () => {
    list(async () => true);
    tick("Cats");
    const rows = screen.getByRole("list").parentElement!;
    const classes = rows.className.split(/\s+/);
    expect(classes).toContain(
      "[&_:is(button,input,select)]:scroll-mb-[calc(var(--mobile-tab-bar-height,3.5rem)+9rem)]",
    );
    expect(classes).toContain("md:[&_:is(button,input,select)]:scroll-mb-28");
    expect(classes).toContain(
      "[&_:is(button,input,select)]:scroll-mt-[calc(var(--app-sticky-top,0px)+0.5rem)]",
    );
    expect(
      rows.contains(screen.getByRole("button", { name: "Log 1 puzzle" })),
    ).toBe(false);
  });

  it("keeps the ticks when saving fails", async () => {
    const store = createStepCommitStore();
    list(async () => false, store);
    tick("Cats");
    let saved: boolean | undefined;
    await act(async () => {
      saved = await store.commit();
    });
    expect(saved).toBe(false);
    expect(store.getSnapshot()?.count).toBe(1);
  });
});

describe("quickStart.solves locale keys", () => {
  it("exist in nl with the same keys as en", () => {
    expect(Object.keys(nl.quickStart.solves)).toEqual(
      Object.keys(en.quickStart.solves),
    );
  });
});

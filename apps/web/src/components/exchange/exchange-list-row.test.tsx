// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { ExchangeListRow, type ListRowExchange } from "./exchange-list-row";
import type { Direction } from "./exchange-state";

const NOW = Date.UTC(2026, 9, 30, 12);
const HOUR = 3_600_000;

const member = (id: string, name: string) => ({
  _id: id,
  _creationTime: 0,
  name,
  isActive: true,
  createdAt: 0,
  updatedAt: 0,
});
const puzzle = (title: string) => ({
  _id: `p_${title}`,
  _creationTime: 0,
  title,
  pieceCount: 1000,
  status: "approved" as const,
  createdAt: 0,
  updatedAt: 0,
});

const me = member("u_me", "Henk");
const anna = member("u_anna", "Anna de Vries");

// Anna asks to swap her "Tulip Fields" for the viewer's "Harbour Lights".
const exchange = (fields: Partial<ListRowExchange> = {}): ListRowExchange => ({
  type: "trade",
  status: "proposed",
  createdAt: NOW - 3 * HOUR,
  requester: anna,
  owner: me,
  requesterState: "visible",
  ownerState: "visible",
  requestedPuzzle: puzzle("Harbour Lights"),
  offeredPuzzle: puzzle("Tulip Fields"),
  ...fields,
});

const renderRow = ({
  fields,
  direction = "incoming",
  focused,
  locale = "en",
}: {
  fields?: Partial<ListRowExchange>;
  direction?: Direction;
  focused?: boolean;
  locale?: "en" | "nl";
} = {}) =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
      now={new Date(NOW)}
    >
      <ExchangeListRow
        exchange={exchange(fields)}
        direction={direction}
        gradientIndex={0}
        isLast
        focused={focused}
      >
        {(who) => <p>Detail with {who}</p>}
      </ExchangeListRow>
    </IntlProvider>,
  );

// The row's one control: the whole summary toggles the detail.
const toggle = () =>
  screen.getByRole("button", { name: /Harbour Lights/ }) as HTMLButtonElement;

afterEach(cleanup);

describe("ExchangeListRow: one toggle for the whole row", () => {
  it("is a single button whose name carries the row's own text", () => {
    renderRow();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    const name = toggle().textContent ?? "";
    // Label in name: the puzzle titles and the partner a speech user would say are in it.
    expect(name).toContain("Trade · Harbour Lights");
    expect(name).toContain("Tulip Fields");
    expect(name).toContain("with Anna de Vries");
    expect(toggle().type).toBe("button");
  });

  it("expands and collapses the detail, announcing its state", () => {
    renderRow();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Detail with Anna de Vries")).toBeNull();

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    const detail = screen.getByText("Detail with Anna de Vries");
    const controls = toggle().getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(detail.closest(`[id="${controls}"]`)).not.toBeNull();

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Detail with Anna de Vries")).toBeNull();
  });

  it("starts expanded when a notification deep-links to it", () => {
    renderRow({ focused: true });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Detail with Anna de Vries")).toBeTruthy();
  });

  it("indents the detail under the text only from sm, full width on phones", () => {
    renderRow({ focused: true });
    const panel = document.getElementById(
      toggle().getAttribute("aria-controls") ?? "",
    );
    expect(panel?.className).toContain("sm:ml-[60px]");
    expect(panel?.className).not.toMatch(/(^|\s)ml-\[60px\]/);
  });
});

describe("ExchangeListRow: deep links", () => {
  // The same row with a changing highlight: the page keeps its key stable across this.
  const row = (focused: boolean) => (
    <IntlProvider
      locale="en"
      messages={en}
      timeZone="Europe/Amsterdam"
      now={new Date(NOW)}
    >
      <ExchangeListRow
        exchange={exchange()}
        direction="incoming"
        gradientIndex={0}
        isLast
        focused={focused}
      >
        {(who) => <p>Detail with {who}</p>}
      </ExchangeListRow>
    </IntlProvider>
  );

  it("stays open when the highlight goes, so changing a filter doesn't collapse it", () => {
    const { rerender } = render(row(true));
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    const button = toggle();

    rerender(row(false));
    expect(toggle()).toBe(button);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("opens when a deep link lands on it later, and the member can still collapse it", () => {
    const { rerender } = render(row(false));
    expect(toggle().getAttribute("aria-expanded")).toBe("false");

    rerender(row(true));
    expect(toggle().getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle());
    rerender(row(true));
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("ExchangeListRow: covers", () => {
  const HARBOUR = "https://cdn.example/harbour.jpg";
  const TULIPS = "https://cdn.example/tulips.jpg";
  const covers = () =>
    [...toggle().querySelectorAll("img")].map((img) => img.getAttribute("src"));

  it("shows both covers of a swap, the viewer's own puzzle in front", () => {
    // Incoming: the requested copy (Harbour Lights) is the viewer's, the headline's first title.
    renderRow({
      fields: { requestedCoverUrl: HARBOUR, offeredCoverUrl: TULIPS },
    });
    // Back first in DOM order, so the front one paints over it.
    expect(covers()).toEqual([TULIPS, HARBOUR]);
  });

  it("puts the viewer's offered puzzle in front on a swap they asked for", () => {
    renderRow({
      direction: "outgoing",
      fields: { requestedCoverUrl: HARBOUR, offeredCoverUrl: TULIPS },
    });
    expect(covers()).toEqual([HARBOUR, TULIPS]);
  });

  it("shows the one cover of a lend or sale", () => {
    renderRow({
      fields: {
        type: "loan",
        offeredPuzzle: null,
        requestedCoverUrl: HARBOUR,
        offeredCoverUrl: null,
      },
    });
    expect(covers()).toEqual([HARBOUR]);
  });

  it("keeps the kind chip when there is no cover, or the backend sends none", () => {
    renderRow({ fields: { requestedCoverUrl: null, offeredCoverUrl: null } });
    expect(covers()).toEqual([]);
    cleanup();
    renderRow();
    expect(covers()).toEqual([]);
    expect(toggle().querySelector("svg")).not.toBeNull();
  });
});

describe("ExchangeListRow: phone layout", () => {
  it("wraps the title over two lines instead of cutting it", () => {
    renderRow();
    const title = screen.getByText(/^Trade · Harbour Lights/);
    expect(title.className).toContain("line-clamp-2");
    expect(title.className).not.toContain("truncate");
  });

  it("keeps the partner's name whole in the meta line", () => {
    renderRow();
    const meta = screen.getByText(/with Anna de Vries/);
    expect(meta.className).not.toContain("truncate");
  });

  it("puts the status pill under the meta line on phones, beside the text from sm", () => {
    renderRow();
    const pills = screen.getAllByText("Pending");
    expect(pills).toHaveLength(2);
    const [inMeta, trailing] = pills;
    // Phones: the pill joins the meta lines, so the text block gets the row's full width.
    expect(inMeta.className).toContain("sm:hidden");
    expect(inMeta.closest("[data-row-text]")).not.toBeNull();
    // From sm: the pill sits at the row's end, as before.
    expect(trailing.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(trailing.className).toContain("sm:inline-flex");
    expect(trailing.closest("[data-row-text]")).toBeNull();
  });

  it("shows the Your turn and offer chips in the same line as the phone pill", () => {
    renderRow({
      fields: {
        type: "sale",
        status: "accepted",
        offeredPuzzle: null,
        salePrice: { amount: 1500, currency: "EUR" },
        // Only the partner (the requester, i.e. initiator) has confirmed.
        initiatorConfirmationTimestamp: NOW - HOUR,
      },
    });
    const yourTurn = screen.getByText("Your turn");
    const offer = screen.getByText("Offer: €15.00");
    const [phonePill] = screen.getAllByText("Accepted");
    expect(yourTurn.parentElement).toBe(phonePill.parentElement);
    expect(offer.parentElement).toBe(phonePill.parentElement);
  });

  it("says a settled lend's puzzle is still on loan instead of Completed", () => {
    renderRow({
      fields: {
        type: "loan",
        status: "completed",
        offeredPuzzle: null,
        loan: { status: "open", openedAt: NOW - HOUR },
      },
    });
    // Once on phones (in the chip line), once from sm (at the row's end).
    expect(screen.getAllByText("On loan")).toHaveLength(2);
    expect(screen.queryByText("Completed")).toBeNull();
  });

  it("is translated (nl)", () => {
    renderRow({ locale: "nl" });
    const name = toggle().textContent ?? "";
    expect(name).toContain("Ruil · Harbour Lights");
    expect(name).toContain("met Anna de Vries");
    expect(screen.getAllByText("In afwachting")).toHaveLength(2);
  });
});

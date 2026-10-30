// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  ExchangeStatusPill,
  LoanDueChip,
  OfferChip,
  ReturnBy,
  SaleOffer,
} from "./exchange-pills";

const PRICE = { amount: 1500, currency: "EUR" };

// "Today" for the loan chips, built from local parts: 30 Oct 2026, afternoon.
const NOW = new Date(2026, 9, 30, 15, 30);
const midday = (month: number, day: number) =>
  new Date(2026, month, day, 12).getTime();

const renderIn = (locale: "en" | "nl", ui: ReactNode) =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
      now={NOW}
    >
      {ui}
    </IntlProvider>,
  );

afterEach(cleanup);

describe("ExchangeStatusPill", () => {
  const opened = midday(9, 1);

  it("names an exchange's status", () => {
    renderIn("en", <ExchangeStatusPill status="proposed" />);
    expect(screen.getByText("Pending")).toBeTruthy();
  });

  it("says a settled lend's puzzle is still on loan", () => {
    renderIn(
      "en",
      <ExchangeStatusPill
        status="completed"
        loan={{ status: "open", openedAt: opened }}
      />,
    );
    const pill = screen.getByText("On loan");
    // Ongoing, like an accepted exchange; not the green of a finished one.
    expect(pill.className).toContain("text-jigsaw-primary");
    expect(screen.queryByText("Completed")).toBeNull();
  });

  it("says when a lent puzzle came back", () => {
    renderIn(
      "en",
      <ExchangeStatusPill
        status="completed"
        loan={{ status: "returned", openedAt: opened, closedAt: midday(9, 28) }}
      />,
    );
    expect(screen.getByText("Returned Oct 28").className).toContain("green");
    cleanup();
    renderIn(
      "en",
      <ExchangeStatusPill
        status="completed"
        loan={{ status: "recalled", openedAt: opened, closedAt: midday(9, 28) }}
      />,
    );
    expect(screen.getByText("Recalled Oct 28").className).toContain("green");
  });

  it("adds the year to a return in another year", () => {
    renderIn(
      "en",
      <ExchangeStatusPill
        status="completed"
        loan={{
          status: "returned",
          openedAt: new Date(2025, 10, 1).getTime(),
          closedAt: new Date(2025, 11, 3, 12).getTime(),
        }}
      />,
    );
    expect(screen.getByText("Returned Dec 3, 2025")).toBeTruthy();
  });

  it("still says it came back when the closing date is missing", () => {
    renderIn(
      "en",
      <ExchangeStatusPill
        status="completed"
        loan={{ status: "recalled", openedAt: opened }}
      />,
    );
    expect(screen.getByText("Recalled")).toBeTruthy();
  });

  it("keeps Completed when the loan is unknown or the backend sends none", () => {
    renderIn("en", <ExchangeStatusPill status="completed" loan={null} />);
    expect(screen.getByText("Completed")).toBeTruthy();
    cleanup();
    renderIn("en", <ExchangeStatusPill status="completed" />);
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("is translated (nl)", () => {
    renderIn(
      "nl",
      <ExchangeStatusPill
        status="completed"
        loan={{ status: "open", openedAt: opened }}
      />,
    );
    expect(screen.getByText("In bruikleen")).toBeTruthy();
    cleanup();
    renderIn(
      "nl",
      <ExchangeStatusPill
        status="completed"
        loan={{ status: "returned", openedAt: opened, closedAt: midday(9, 28) }}
      />,
    );
    expect(screen.getByText("Teruggegeven op 28 okt")).toBeTruthy();
    cleanup();
    renderIn(
      "nl",
      <ExchangeStatusPill
        status="completed"
        loan={{ status: "recalled", openedAt: opened, closedAt: midday(9, 28) }}
      />,
    );
    expect(screen.getByText("Teruggevraagd op 28 okt")).toBeTruthy();
  });
});

describe("OfferChip", () => {
  it("shows the offered price from cents in the row's currency", () => {
    renderIn("en", <OfferChip price={PRICE} />);
    expect(screen.getByText("Offer: €15.00")).toBeTruthy();
  });

  it("formats the price the Dutch way", () => {
    renderIn("nl", <OfferChip price={{ amount: 1999, currency: "EUR" }} />);
    expect(screen.getByText(/^Bod: €\s19,99$/)).toBeTruthy();
  });
});

describe("SaleOffer", () => {
  it("tells the owner what the buyer offers", () => {
    renderIn(
      "en",
      <SaleOffer price={PRICE} direction="incoming" partnerName="Anna" />,
    );
    expect(screen.getByText("Anna offers €15.00")).toBeTruthy();
  });

  it("reminds the buyer what they offered", () => {
    renderIn(
      "en",
      <SaleOffer price={PRICE} direction="outgoing" partnerName="Anna" />,
    );
    expect(screen.getByText("You offer €15.00")).toBeTruthy();
  });

  it("is translated (nl)", () => {
    renderIn(
      "nl",
      <SaleOffer price={PRICE} direction="incoming" partnerName="Anna" />,
    );
    expect(screen.getByText(/^Anna biedt €\s15,00$/)).toBeTruthy();
  });
});

describe("ReturnBy", () => {
  it("shows a loan's return date", () => {
    renderIn("en", <ReturnBy loanReturnDate={midday(10, 13)} />);
    expect(screen.getByText("Return by Fri, Nov 13, 2026")).toBeTruthy();
  });

  it("says when a loan has no fixed return date", () => {
    renderIn("en", <ReturnBy />);
    expect(screen.getByText("No fixed return date")).toBeTruthy();
  });

  it("is translated (nl)", () => {
    renderIn("nl", <ReturnBy loanReturnDate={midday(10, 13)} />);
    expect(screen.getByText("Uiterlijk terug op vr 13 nov 2026")).toBeTruthy();
    cleanup();
    renderIn("nl", <ReturnBy />);
    expect(screen.getByText("Geen vaste terugbrengdatum")).toBeTruthy();
  });
});

describe("LoanDueChip", () => {
  it.each([
    ["Due in 14 days", midday(10, 13)],
    ["Due tomorrow", midday(9, 31)],
    ["Due today", midday(9, 30)],
    ["1 day overdue", midday(9, 29)],
    ["10 days overdue", midday(9, 20)],
  ])(
    "shows %s, counting calendar days to the return date",
    (text, expectedReturn) => {
      renderIn("en", <LoanDueChip expectedReturn={expectedReturn} />);
      expect(screen.getByText(text)).toBeTruthy();
    },
  );

  it("marks a loan that is due or late in amber, an upcoming one plainly", () => {
    renderIn("en", <LoanDueChip expectedReturn={midday(9, 29)} />);
    expect(screen.getByText("1 day overdue").className).toContain("amber");
    cleanup();
    renderIn("en", <LoanDueChip expectedReturn={midday(9, 30)} />);
    expect(screen.getByText("Due today").className).toContain("amber");
    cleanup();
    renderIn("en", <LoanDueChip expectedReturn={midday(10, 2)} />);
    expect(screen.getByText("Due in 3 days").className).not.toContain("amber");
  });

  it("renders nothing for an open-ended loan", () => {
    const { container } = renderIn("en", <LoanDueChip />);
    expect(container.textContent).toBe("");
  });

  it.each([
    ["Moet over 3 dagen terug", midday(10, 2)],
    ["Moet morgen terug", midday(9, 31)],
    ["Moet vandaag terug", midday(9, 30)],
    ["1 dag te laat", midday(9, 29)],
    ["3 dagen te laat", midday(9, 27)],
  ])("is translated (nl: %s)", (text, expectedReturn) => {
    renderIn("nl", <LoanDueChip expectedReturn={expectedReturn} />);
    expect(screen.getByText(text)).toBeTruthy();
  });
});

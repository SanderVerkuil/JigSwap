// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { OfferChip, SaleOffer } from "./exchange-pills";

const PRICE = { amount: 1500, currency: "EUR" };

const renderIn = (locale: "en" | "nl", ui: ReactNode) =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      {ui}
    </IntlProvider>,
  );

afterEach(cleanup);

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

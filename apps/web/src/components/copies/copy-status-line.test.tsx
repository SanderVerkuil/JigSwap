// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { CopyStatusLine } from "./copy-status-line";

// One line under the copy's title says where the copy is and who can see it: custody (an open loan,
// with Recall), else the offers plus visibility for whoever manages it; visitors only see the offers.

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => async () => null,
}));

const CLOSED = { forTrade: false, forLend: false, forSale: false };
// 3 March 2026, 10:00 in Amsterdam.
const MARCH_3 = Date.UTC(2026, 2, 3, 9);

type Props = Parameters<typeof CopyStatusLine>[0];

const renderLine = (props: Partial<Props>, locale: "en" | "nl" = "en") =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <CopyStatusLine
          detailed
          availability={CLOSED}
          visibilityPreference="visible"
          openLoan={null}
          {...props}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );

const line = () => screen.getByTestId("copy-status-line").textContent;

afterEach(cleanup);

describe("CopyStatusLine for whoever manages the copy", () => {
  it("an open loan names the borrower and the date, with Recall", () => {
    renderLine({
      openLoan: {
        puzzleTitle: "Tulip Fields",
        borrowerName: "Anna",
        openedAt: MARCH_3,
        loanId: "loan1",
      },
    });
    expect(line()).toContain("On loan to Anna since Mar 3, 2026");
    expect(screen.getByRole("button", { name: "Recall" })).toBeTruthy();
  });

  it("an open loan whose loan id isn't known yet has no Recall", () => {
    renderLine({
      openLoan: {
        puzzleTitle: "Tulip Fields",
        borrowerName: "Anna",
        openedAt: MARCH_3,
        loanId: null,
      },
    });
    expect(line()).toContain("On loan to Anna");
    expect(screen.queryByRole("button", { name: "Recall" })).toBeNull();
  });

  it("an offered copy lists its offers and that the community can see it", () => {
    renderLine({ availability: { ...CLOSED, forTrade: true, forLend: true } });
    expect(line()).toBe(
      "Offered for swap and lending · Visible to the community",
    );
  });

  it("an offered copy the owner keeps private says it is visible only while offered", () => {
    renderLine({
      availability: { ...CLOSED, forSale: true },
      visibilityPreference: "private",
    });
    expect(line()).toBe(
      "Offered for sale · Visible while offered, private again when you withdraw",
    );
  });

  it("a visible copy that isn't offered says so", () => {
    renderLine({});
    expect(line()).toBe("Not offered · Friends can see it");
  });

  it("says the same in Dutch", () => {
    renderLine({}, "nl");
    expect(line()).toBe("Niet aangeboden · Vrienden kunnen hem zien");
  });

  it("a private copy says who can see it", () => {
    renderLine({ visibilityPreference: "private" });
    expect(line()).toBe("Private — only you and your household");
  });

  it("reads naturally in Dutch", () => {
    renderLine(
      { availability: { ...CLOSED, forTrade: true, forLend: true } },
      "nl",
    );
    expect(line()).toBe(
      "Aangeboden voor ruil en uitlenen · Zichtbaar voor de community",
    );
  });
});

describe("CopyStatusLine for visitors", () => {
  it("shows only the offers, never visibility or custody", () => {
    renderLine({
      detailed: false,
      availability: { ...CLOSED, forTrade: true },
      visibilityPreference: "private",
    });
    expect(line()).toBe("Offered for swap");
  });

  it("renders nothing for a copy that isn't offered", () => {
    renderLine({
      detailed: false,
      openLoan: {
        puzzleTitle: "Tulip Fields",
        borrowerName: "Anna",
        openedAt: MARCH_3,
        loanId: "loan1",
      },
    });
    expect(screen.queryByTestId("copy-status-line")).toBeNull();
  });
});

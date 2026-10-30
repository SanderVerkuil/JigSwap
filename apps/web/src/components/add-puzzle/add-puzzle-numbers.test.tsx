import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { LivePreviewCard } from "./live-preview-card";
import { MatchConfirm } from "./match-confirm";

// The add-puzzle preview and the import match show piece counts in the app locale (UX-63).
const catalogs = { en, nl } as const;
const html = (locale: keyof typeof catalogs, node: React.ReactNode) =>
  renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={catalogs[locale]}
      timeZone="Europe/Amsterdam"
    >
      {node}
    </IntlProvider>,
  ).replace(/<[^>]+>/g, "");

const noop = () => {};

describe.each([
  ["en", "1,000"],
  ["nl", "1.000"],
] as const)("piece counts in %s", (locale, expected) => {
  const pieces = catalogs[locale].puzzles.pieces;

  it("formats the live preview's count", () => {
    const text = html(
      locale,
      <LivePreviewCard
        title="Harbour"
        brand="Ravensburger"
        pieceCount={1000}
        available={false}
      />,
    );
    expect(text).toContain(`${expected} ${pieces}`);
  });

  it("formats the imported match's count", () => {
    const text = html(
      locale,
      <MatchConfirm
        match={{ puzzleId: "p1", title: "Harbour", pieceCount: 1000 }}
        onUse={noop}
        onIgnore={noop}
      />,
    );
    expect(text).toContain(`${expected} ${pieces}`);
  });
});

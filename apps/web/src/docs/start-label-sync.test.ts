import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../locales/en.json";
import nl from "../../locales/nl.json";

// The guides name the app's buttons and pages in bold. When a label changes, the guide has to
// change with it: the sign-up guide once sent readers to a "Start trading" button that no longer
// existed, and other guides to a "Leave Review" button and a "Bladeren" page.
const DOCS = join(import.meta.dirname, "../../../../docs/user");
const guide = (locale: string, path: string) =>
  readFileSync(join(DOCS, locale, path), "utf8");

type Messages = typeof en;

describe("accounts-and-sign-in guide", () => {
  it.each([
    ["en", en],
    ["nl", nl],
  ] as const)(
    "names the header's buttons as they read in %s",
    (locale, messages) => {
      const text = guide(locale, "getting-started/accounts-and-sign-in.md");
      expect(text).toContain(`**${messages.marketing.nav.startShelf}**`);
      expect(text).toContain(`**${messages.marketing.nav.login}**`);
    },
  );
});

// Each guide with a label it quotes, in both languages.
const QUOTED: ReadonlyArray<
  readonly [path: string, label: (messages: Messages) => string]
> = [
  [
    "discovering-and-community/discovering-puzzles.md",
    (m) => m.shell.pages.puzzles.title,
  ],
  [
    "discovering-and-community/reputation-and-reviews.md",
    (m) => m.reputation.leaveReview,
  ],
  [
    "discovering-and-community/reputation-and-reviews.md",
    (m) => m.shell.pages.exchanges.title,
  ],
  [
    "your-library/managing-your-puzzles.md",
    (m) => m.shell.pages.myPuzzles.title,
  ],
  ["your-library/managing-your-puzzles.md", (m) => m.shell.mobile.tabs.library],
  ["your-library/managing-your-puzzles.md", (m) => m.puzzles.filters.lentOut],
  ["your-library/managing-your-puzzles.md", (m) => m.lending.recallAction],
  ["your-library/adding-and-importing.md", (m) => m.shell.pages.puzzles.title],
  ["your-library/adding-and-importing.md", (m) => m.puzzles.contributePuzzle],
  ["sharing-and-exchanges/lend-swap-trade.md", (m) => m.trades.markComplete],
  [
    "sharing-and-exchanges/lend-swap-trade.md",
    (m) => m.copyInstance.offers.swapLabel,
  ],
  [
    "sharing-and-exchanges/lend-swap-trade.md",
    (m) => m.copyInstance.offers.lendLabel,
  ],
];

describe("guides that quote the app's labels", () => {
  it.each(
    (["en", "nl"] as const).flatMap((locale) =>
      QUOTED.map(([path, label]) => {
        const text = label(locale === "en" ? en : nl);
        return [locale, path, text] as const;
      }),
    ),
  )("%s %s names **%s**", (locale, path, text) => {
    expect(guide(locale, path)).toContain(`**${text}**`);
  });

  // The English guides shorten Browse Puzzles to Browse; the Dutch ones name the page in full.
  it("names Puzzels ontdekken as the Dutch nav reads", () => {
    expect(
      guide("nl", "discovering-and-community/discovering-puzzles.md"),
    ).toContain(`**${nl.shell.pages.browse.title}**`);
  });
});

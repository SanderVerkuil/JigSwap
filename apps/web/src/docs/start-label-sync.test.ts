import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../locales/en.json";
import nl from "../../locales/nl.json";

// The sign-up guide names the public header's buttons in bold. When a label changes, the guide has
// to change with it: it once sent readers to a "Start trading" button that no longer existed.
const DOCS = join(import.meta.dirname, "../../../../docs/user");
const guide = (locale: string) =>
  readFileSync(
    join(DOCS, locale, "getting-started/accounts-and-sign-in.md"),
    "utf8",
  );

describe("accounts-and-sign-in guide", () => {
  it.each([
    ["en", en],
    ["nl", nl],
  ] as const)(
    "names the header's buttons as they read in %s",
    (locale, messages) => {
      const text = guide(locale);
      expect(text).toContain(`**${messages.marketing.nav.startShelf}**`);
      expect(text).toContain(`**${messages.marketing.nav.login}**`);
    },
  );
});

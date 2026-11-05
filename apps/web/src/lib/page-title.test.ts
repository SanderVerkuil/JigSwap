import { describe, expect, it } from "vitest";
import en from "../../locales/en.json";
import nl from "../../locales/nl.json";
import { defaultDocumentTitle } from "./page-title";

const context = (messages: unknown) => ({ intl: { messages } });

describe("defaultDocumentTitle", () => {
  it("is the brand on a page that sets no title of its own", () => {
    const matches = [{ _notFound: undefined }, { _notFound: undefined }];
    expect(defaultDocumentTitle(context(en), matches)).toBe("JigSwap");
  });

  it("says page not found when the router has no route for the URL, whichever layout renders the 404", () => {
    expect(defaultDocumentTitle(context(en), [{ _notFound: true }])).toBe(
      "Page not found — JigSwap",
    );
    expect(
      defaultDocumentTitle(context(en), [
        { _notFound: undefined },
        { _notFound: true },
      ]),
    ).toBe("Page not found — JigSwap");
  });

  it("speaks the visitor's language", () => {
    expect(defaultDocumentTitle(context(nl), [{ _notFound: true }])).toBe(
      nl.marketing.titles.notFound,
    );
  });

  it("falls back to the brand without an intl payload", () => {
    expect(defaultDocumentTitle(undefined, [{ _notFound: true }])).toBe(
      "JigSwap",
    );
  });
});

// @vitest-environment happy-dom
import { CONDITION_VALUES } from "@/components/add-puzzle/add-puzzle-schema";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createTranslator, IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import { useConditionLabel, useConditionOptions } from "./condition";

// One condition vocabulary: the word a member picks for a copy's condition is the word every
// card, the copy page and the catalogue show for it afterwards, in every catalog.

const catalogs = { en, nl, source } as const;

afterEach(cleanup);

const withMessages = (messages: typeof en, locale: string) =>
  function Messages({ children }: { children: ReactNode }) {
    return (
      <IntlProvider
        locale={locale}
        messages={messages}
        timeZone="Europe/Amsterdam"
      >
        {children}
      </IntlProvider>
    );
  };

describe("condition labels", () => {
  it.each(Object.entries(catalogs))(
    "%s names every condition a copy can have",
    (name, messages) => {
      const t = createTranslator({
        locale: name === "nl" ? "nl" : "en",
        messages,
        namespace: "condition",
      });
      for (const value of CONDITION_VALUES) {
        const label = t(value);
        expect(label, value).not.toBe("");
        expect(label, value).not.toContain("condition.");
      }
    },
  );

  it("source.json mirrors en.json", () => {
    expect(source.condition).toEqual(en.condition);
  });

  it("reads the same words in English and Dutch on every surface", () => {
    const label = (messages: typeof en, locale: string) =>
      renderHook(() => useConditionLabel(), {
        wrapper: withMessages(messages, locale),
      }).result.current;

    expect(CONDITION_VALUES.map(label(en, "en"))).toEqual([
      "New (sealed)",
      "Like new",
      "Good",
      "Fair",
      "Poor",
    ]);
    expect(CONDITION_VALUES.map(label(nl, "nl"))).toEqual([
      "Nieuw (verzegeld)",
      "Zo goed als nieuw",
      "Goed",
      "Redelijk",
      "Slecht",
    ]);
  });
});

describe("condition picker", () => {
  it("offers all five conditions, best first, including New (sealed)", () => {
    const { result } = renderHook(() => useConditionOptions(), {
      wrapper: withMessages(en, "en"),
    });
    expect(result.current).toEqual([
      { value: "new_sealed", label: "New (sealed)" },
      { value: "like_new", label: "Like new" },
      { value: "good", label: "Good" },
      { value: "fair", label: "Fair" },
      { value: "poor", label: "Poor" },
    ]);
  });
});

// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { PuzzleCoverFallback } from "./catalog-detail-parts";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (checking: boolean, locale: "en" | "nl" = "en") =>
  act(() =>
    root.render(
      <IntlProvider
        locale={locale}
        timeZone="UTC"
        messages={locale === "en" ? en : nl}
      >
        <PuzzleCoverFallback checking={checking} />
      </IntlProvider>,
    ),
  );

describe("PuzzleCoverFallback", () => {
  it("is a plain placeholder by default", () => {
    render(false);
    expect(container.textContent).toBe("");
  });

  it("labels the placeholder while the uploader's box art is being checked (en/nl)", () => {
    render(true);
    expect(container.textContent).toContain("Being checked");
    render(true, "nl");
    expect(container.textContent).toContain("Wordt gecontroleerd");
  });
});

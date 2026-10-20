// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { FlagDetail, type FlaggedPhoto } from "./flag-detail";

vi.mock("@/gateway", () => ({ gateway: {} }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const photo = {
  imageId: "p1",
  url: "https://example.test/p1.jpg",
  score: 0.9,
  label: "nudity",
  uploaderName: "alice",
  puzzleTitle: "Mountain Vista",
  uploadedAt: 0,
  hashTimedOut: false,
} as FlaggedPhoto;

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

const render = (flagged: FlaggedPhoto, locale: "en" | "nl" = "en") =>
  act(() =>
    root.render(
      <IntlProvider
        locale={locale}
        timeZone="UTC"
        messages={locale === "en" ? en : nl}
      >
        <FlagDetail
          photo={flagged}
          busy={false}
          onConfirmRemoval={() => {}}
          onRestore={() => {}}
        />
      </IntlProvider>,
    ),
  );

describe("FlagDetail", () => {
  it("a photo rejected after its hash check timed out shows its image behind the blur guard and says restoring does not publish it (en/nl)", () => {
    render({ ...photo, hashTimedOut: true });
    expect(container.querySelector("img")?.getAttribute("src")).toBe(photo.url);
    expect(
      container.querySelector("button[aria-pressed='false']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Restoring it does not publish it");
    render({ ...photo, hashTimedOut: true }, "nl");
    expect(container.textContent).toContain("Herstellen publiceert hem niet");
  });

  it("an ordinary flagged photo has no timed-out hint", () => {
    render(photo);
    expect(container.textContent).not.toContain(
      "Restoring it does not publish it",
    );
  });
});

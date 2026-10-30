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

const render = (
  flagged: FlaggedPhoto,
  locale: "en" | "nl" = "en",
  props: Partial<Parameters<typeof FlagDetail>[0]> = {},
) =>
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
          {...props}
        />
      </IntlProvider>,
    ),
  );

const buttonIn = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
const dialog = () =>
  document.body.querySelector<HTMLElement>("[role='alertdialog']");

describe("FlagDetail", () => {
  it("a photo rejected after its hash check timed out shows its image behind the blur guard and says restoring does not publish it (en/nl)", () => {
    render({ ...photo, hashTimedOut: true });
    expect(container.querySelector("img")?.getAttribute("src")).toBe(photo.url);
    expect(
      [...container.querySelectorAll("button")].some(
        (b) => b.textContent === "Click or tap to reveal the photo",
      ),
    ).toBe(true);
    expect(container.textContent).toContain("Restoring it does not publish it");
    render({ ...photo, hashTimedOut: true }, "nl");
    expect(container.textContent).toContain("Herstellen publiceert hem niet");
  });

  it("Confirm removal asks in a dialog that says the photo is deleted and the uploader told, and only then removes it (en/nl)", () => {
    const onConfirmRemoval = vi.fn();
    render(photo, "en", { onConfirmRemoval });
    act(() => buttonIn(container, "Confirm Removal")!.click());
    expect(onConfirmRemoval).not.toHaveBeenCalled();
    const confirm = dialog()!;
    expect(confirm.textContent).toContain("Remove this photo for good?");
    expect(confirm.textContent).toContain(
      "The photo is deleted from the copy and its uploader is told it was removed.",
    );
    act(() => buttonIn(confirm, "Cancel")!.click());
    expect(onConfirmRemoval).not.toHaveBeenCalled();

    act(() => buttonIn(container, "Confirm Removal")!.click());
    act(() => buttonIn(dialog()!, "Remove photo")!.click());
    expect(onConfirmRemoval).toHaveBeenCalledTimes(1);

    render(photo, "nl", { onConfirmRemoval });
    act(() => buttonIn(container, "Verwijdering bevestigen")!.click());
    expect(dialog()!.textContent).toContain(
      "Deze foto definitief verwijderen?",
    );
  });

  it("an ordinary flagged photo has no timed-out hint", () => {
    render(photo);
    expect(container.textContent).not.toContain(
      "Restoring it does not publish it",
    );
  });
});

// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { AppealDetail, type ImageReviewRequest } from "./appeal-detail";

vi.mock("@/gateway", () => ({ gateway: {} }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const request: ImageReviewRequest = {
  attachmentId: "a1" as ImageReviewRequest["attachmentId"],
  url: "https://example.test/a1.jpg",
  score: 0.82,
  label: "suggestive",
  reason: null,
  uploaderName: "alice",
  uploadedAt: Date.UTC(2026, 9, 20, 9, 0),
  reviewRequestedAt: Date.UTC(2026, 9, 21, 14, 30),
};

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
  appeal: ImageReviewRequest,
  locale: "en" | "nl" = "en",
  props: Partial<Parameters<typeof AppealDetail>[0]> = {},
) =>
  act(() =>
    root.render(
      <IntlProvider
        locale={locale}
        timeZone="UTC"
        messages={locale === "en" ? en : nl}
      >
        <AppealDetail
          request={appeal}
          busy={false}
          onRestore={() => {}}
          onKeepRemoved={() => {}}
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

describe("AppealDetail", () => {
  it("shows the photo behind the blur guard with its verdict, sender and request time (en/nl)", () => {
    render(request);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      request.url,
    );
    expect(
      buttonIn(container, "Click or tap to reveal the photo"),
    ).toBeDefined();
    expect(container.textContent).toContain("suggestive");
    expect(container.textContent).toContain("82%");
    expect(container.textContent).toContain("alice");
    expect(container.textContent).toContain("Review requested");
    expect(container.textContent).toContain("Oct 21, 2026");
    // Only the photo: nothing about the conversation it was sent in.
    expect(container.textContent).toContain("never the conversation");

    render(request, "nl");
    expect(container.textContent).toContain("Beoordeling gevraagd");
    expect(container.textContent).toContain("Verstuurd door");
  });

  it("says what each decision does, beside the buttons", () => {
    render(request);
    expect(container.textContent).toContain(
      "Restoring approves the photo and delivers it to the conversation once its sender has sent it.",
    );
    expect(container.textContent).toContain(
      "Keeping it removed deletes the photo for good; its sender sees that the decision stands.",
    );
  });

  it("Restore fires at once", () => {
    const onRestore = vi.fn();
    render(request, "en", { onRestore });
    act(() => buttonIn(container, "Restore Photo")!.click());
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it("Keep removed asks in a dialog that says the photo is deleted and the sender sees the decision stands, and only then decides (en/nl)", () => {
    const onKeepRemoved = vi.fn();
    render(request, "en", { onKeepRemoved });
    act(() => buttonIn(container, "Keep Removed")!.click());
    expect(onKeepRemoved).not.toHaveBeenCalled();
    const confirm = dialog()!;
    expect(confirm.textContent).toContain("Keep this photo removed?");
    expect(confirm.textContent).toContain(
      "The photo is deleted for good and its sender sees that the decision stands. This can't be undone.",
    );
    act(() => buttonIn(confirm, "Cancel")!.click());
    expect(onKeepRemoved).not.toHaveBeenCalled();

    act(() => buttonIn(container, "Keep Removed")!.click());
    act(() => buttonIn(dialog()!, "Keep removed")!.click());
    expect(onKeepRemoved).toHaveBeenCalledTimes(1);

    render(request, "nl", { onKeepRemoved });
    act(() => buttonIn(container, "Verwijderd laten")!.click());
    expect(dialog()!.textContent).toContain("Deze foto verwijderd laten?");
  });

  it("without a preview (hash check not passed, or the file is gone) says so and cannot restore", () => {
    const onRestore = vi.fn();
    render({ ...request, url: null }, "en", { onRestore });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(
      "No preview: this photo hasn't passed its hash check yet, or its file is gone.",
    );
    const restore = buttonIn(container, "Restore Photo")!;
    expect(restore.disabled).toBe(true);
    // Keeping it removed is still possible.
    expect(buttonIn(container, "Keep Removed")!.disabled).toBe(false);
  });

  it("disables both decisions while busy", () => {
    render(request, "en", { busy: true });
    expect(buttonIn(container, "Restore Photo")!.disabled).toBe(true);
    expect(buttonIn(container, "Keep Removed")!.disabled).toBe(true);
  });

  it("shows the refusal reason only when there is one", () => {
    render(request);
    expect(container.textContent).not.toContain("Reason");
    render({ ...request, reason: "too_many_pixels" });
    expect(container.textContent).toContain("Reason");
    expect(container.textContent).toContain("too_many_pixels");
  });
});

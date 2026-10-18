// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { UncheckedDetail, type UncheckedPhoto } from "./unchecked-detail";

vi.mock("@/gateway", () => ({ gateway: {} }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const photo: UncheckedPhoto = {
  key: "copy:p1",
  source: "copy",
  imageId: "p1",
  status: "unscored",
  reason: "missing_token",
  attempts: 1,
  url: "https://example.test/p1.jpg",
  puzzleTitle: "Mountain Vista",
  uploaderName: "alice",
  uploadedAt: 0,
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
  vi.useRealTimers();
});

const render = (
  props: Partial<Parameters<typeof UncheckedDetail>[0]> = {},
  locale: "en" | "nl" = "en",
) =>
  act(() =>
    root.render(
      <IntlProvider
        locale={locale}
        timeZone="UTC"
        messages={locale === "en" ? en : nl}
      >
        <UncheckedDetail
          photo={photo}
          busy={false}
          onApprove={() => {}}
          onReject={() => {}}
          {...props}
        />
      </IntlProvider>,
    ),
  );

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label),
  )!;

describe("UncheckedDetail", () => {
  it("shows status, reason, puzzle and uploader (en/nl)", () => {
    render();
    const text = container.textContent ?? "";
    expect(text).toContain("Could not be checked");
    expect(text).toContain("Screening not configured");
    expect(text).toContain("Mountain Vista");
    expect(text).toContain("alice");
    expect(text).toContain("Copy photo");
    render({}, "nl");
    expect(container.textContent).toContain("Kon niet worden gecontroleerd");
  });

  it("an unknown reason falls back to a generic label", () => {
    render({ photo: { ...photo, reason: "something_new" } });
    expect(container.textContent).toContain("Unknown");
  });

  it("approve fires immediately; reject needs a second click", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render({ onApprove, onReject });
    act(() => button("Approve Photo").click());
    expect(onApprove).toHaveBeenCalledTimes(1);

    act(() => button("Reject Photo").click());
    expect(onReject).not.toHaveBeenCalled();
    act(() => button("Are you sure?").click());
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("an armed reject disarms after 3 seconds", () => {
    vi.useFakeTimers();
    const onReject = vi.fn();
    render({ onReject });
    act(() => button("Reject Photo").click());
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    act(() => button("Reject Photo").click());
    expect(onReject).not.toHaveBeenCalled();
  });

  it("busy disables both decisions", () => {
    render({ busy: true });
    expect(button("Approve Photo").disabled).toBe(true);
    expect(button("Reject Photo").disabled).toBe(true);
  });
});

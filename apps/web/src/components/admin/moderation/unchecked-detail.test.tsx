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
  canRecheck: false,
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
          onWaive={() => {}}
          onReject={() => {}}
          onRecheck={() => {}}
          {...props}
        />
      </IntlProvider>,
    ),
  );

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label),
  )!;
const dialog = () =>
  document.body.querySelector<HTMLElement>("[role='alertdialog']");
const dialogButton = (label: string) =>
  [...(dialog()?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent?.trim() === label,
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

  it("a check that never completed or stalled says so (en/nl)", () => {
    render({ photo: { ...photo, reason: "check_failed" } });
    expect(container.textContent).toContain("The check did not complete");
    render({ photo: { ...photo, reason: "stalled" } }, "nl");
    expect(container.textContent).toContain("Na 24 uur nog niet gecontroleerd");
  });

  it("a timed-out hash check says so and warns that approving skips it (en/nl)", () => {
    const timedOut: UncheckedPhoto = {
      ...photo,
      key: "message:m1",
      source: "message",
      status: "hashTimedOut",
      reason: null,
      puzzleTitle: "Message photo",
    };
    render({ photo: timedOut });
    const text = container.textContent ?? "";
    expect(text).toContain("Hash check timed out");
    expect(text).toContain("Message photo");
    expect(text).toContain(
      "Approve without hash check publishes the photo without that check",
    );
    render({ photo: timedOut }, "nl");
    expect(container.textContent).toContain("Hash-check verlopen");
    expect(container.textContent).toContain("Foto in bericht");
    expect(button("Goedkeuren zonder hash-check")).toBeDefined();
  });

  it("a timed-out photo offers only the waiver, which asks in a dialog that says the check is skipped (no plain Approve)", () => {
    const onApprove = vi.fn();
    const onWaive = vi.fn();
    render({
      photo: { ...photo, status: "hashTimedOut", reason: null },
      onApprove,
      onWaive,
    });
    expect(button("Approve Photo")).toBeUndefined();

    act(() => button("Approve without hash check").click());
    expect(onWaive).not.toHaveBeenCalled();
    const text = dialog()!.textContent ?? "";
    expect(text).toContain("Publish without the hash check?");
    expect(text).toContain(
      "This photo was never checked against known abuse material.",
    );
    // The waiver repeats what approving does to this kind of photo.
    expect(text).toContain(
      "Approving shows the photo on its copy to other members.",
    );
    act(() => dialogButton("Approve without hash check").click());
    expect(onWaive).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("cancelling the waiver or the rejection does nothing", () => {
    const onWaive = vi.fn();
    const onReject = vi.fn();
    render({
      photo: { ...photo, status: "hashTimedOut", reason: null },
      onWaive,
      onReject,
    });
    act(() => button("Approve without hash check").click());
    act(() => dialogButton("Cancel").click());
    act(() => button("Reject Photo").click());
    act(() => dialogButton("Cancel").click());
    expect(onWaive).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it("an ordinary unchecked photo offers no waiver", () => {
    render();
    expect(button("Approve without hash check")).toBeUndefined();
    expect(button("Approve Photo")).toBeDefined();
  });

  it("says in one sentence per decision what approving and rejecting do to this kind of photo (en/nl)", () => {
    render();
    let text = container.textContent ?? "";
    expect(text).toContain(
      "Approving shows the photo on its copy to other members.",
    );
    expect(text).toContain(
      "Rejecting hides it and moves it to Flagged, where it can still be restored or removed for good.",
    );
    // Only this photo's source is explained, not every source at once.
    expect(text).not.toContain("conversation");
    expect(text).not.toContain("Check again runs");

    render({
      photo: {
        ...photo,
        key: "message:m1",
        source: "message",
        status: "unscored",
        canRecheck: true,
      },
    });
    text = container.textContent ?? "";
    expect(text).toContain("Approving shows the photo in its conversation.");
    expect(text).toContain(
      "Rejecting removes the photo for both members and tells the sender.",
    );
    expect(text).toContain("Check again runs the automated check once more");
    expect(text).not.toContain("moves it to Flagged");

    render({ photo: { ...photo, source: "circleIcon" } }, "nl");
    text = container.textContent ?? "";
    expect(text).toContain(
      "Goedkeuren maakt dit het nieuwe pictogram van de kring.",
    );
    expect(text).toContain(
      "Afwijzen verwijdert het pictogram; de kring houdt zijn vorige pictogram.",
    );
  });

  it("an unknown reason falls back to a generic label", () => {
    render({ photo: { ...photo, reason: "something_new" } });
    expect(container.textContent).toContain("Unknown");
  });

  it("approve fires immediately; reject asks in a dialog that repeats what rejecting does to this source (en/nl)", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render({ onApprove, onReject });
    act(() => button("Approve Photo").click());
    expect(onApprove).toHaveBeenCalledTimes(1);

    act(() => button("Reject Photo").click());
    expect(onReject).not.toHaveBeenCalled();
    expect(dialog()!.textContent).toContain("Reject this photo?");
    expect(dialog()!.textContent).toContain(
      "Rejecting hides it and moves it to Flagged",
    );
    act(() => dialogButton("Reject Photo").click());
    expect(onReject).toHaveBeenCalledTimes(1);

    render(
      {
        photo: {
          ...photo,
          key: "message:m1",
          source: "message",
          status: "unscored",
          canRecheck: true,
        },
      },
      "nl",
    );
    act(() => button("Foto afwijzen").click());
    expect(dialog()!.textContent).toContain("Deze foto afwijzen?");
    expect(dialog()!.textContent).toContain(
      "Afwijzen verwijdert de foto voor beide leden en laat de afzender dat weten.",
    );
  });

  it("offers Check again on a copy or completion photo that can be re-checked", () => {
    const onRecheck = vi.fn();
    render({ photo: { ...photo, canRecheck: true }, onRecheck });
    act(() => button("Check again").click());
    render({
      photo: {
        ...photo,
        key: "completion:c1",
        source: "completion",
        imageId: "c1",
        canRecheck: true,
      },
      onRecheck,
    });
    expect(container.textContent).toContain("Completion photo");
    act(() => button("Check again").click());
    expect(onRecheck).toHaveBeenCalledTimes(2);
  });

  it("offers Check again only for box art that can be re-checked (en/nl)", () => {
    render();
    expect(button("Check again")).toBeUndefined();
    const onRecheck = vi.fn();
    render({
      photo: {
        ...photo,
        key: "boxArt:b1",
        source: "boxArt",
        imageId: "b1",
        canRecheck: true,
      },
      onRecheck,
    });
    expect(container.textContent).toContain("Box art");
    act(() => button("Check again").click());
    expect(onRecheck).toHaveBeenCalledTimes(1);
    render({ photo: { ...photo, source: "boxArt", canRecheck: true } }, "nl");
    expect(container.textContent).toContain("Opnieuw controleren");
    expect(container.textContent).toContain("Catalogusafbeelding");
  });

  it("busy disables both decisions", () => {
    render({ busy: true });
    expect(button("Approve Photo").disabled).toBe(true);
    expect(button("Reject Photo").disabled).toBe(true);
  });
});

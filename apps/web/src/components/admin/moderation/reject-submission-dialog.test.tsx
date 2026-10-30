// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import {
  composeRejectionReason,
  RejectSubmissionDialog,
} from "./reject-submission-dialog";

afterEach(cleanup);

type Props = {
  duplicateTitle?: string;
  handledElsewhere?: boolean;
  onReject?: (reason: string) => Promise<void>;
};
const ui = (
  { duplicateTitle, handledElsewhere = false, onReject }: Props,
  locale: "en" | "nl" = "en",
) => (
  <IntlProvider locale={locale} messages={locale === "en" ? en : nl}>
    <RejectSubmissionDialog
      submissionTitle="Starry Night (1000)"
      duplicateTitle={duplicateTitle}
      open
      onOpenChange={vi.fn()}
      onReject={onReject ?? vi.fn(() => Promise.resolve())}
      busy={false}
      handledElsewhere={handledElsewhere}
    />
  </IntlProvider>
);

const rejectButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Reject submission" });
const note = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Note for the member",
  });

describe("composeRejectionReason", () => {
  it("is the preset text alone without a note", () => {
    expect(
      composeRejectionReason("notJigsaw", "Not a jigsaw puzzle", "  "),
    ).toBe("Not a jigsaw puzzle");
  });

  it("adds a trimmed note after the preset text", () => {
    expect(
      composeRejectionReason(
        "incomplete",
        "Incomplete or wrong details",
        "  The piece count is 500, not 1000. ",
      ),
    ).toBe("Incomplete or wrong details. The piece count is 500, not 1000.");
  });

  it("is only the note for Other (the member learns nothing from “Other”)", () => {
    expect(composeRejectionReason("other", "Other reason", " Spam ")).toBe(
      "Spam",
    );
    expect(composeRejectionReason("other", "Other reason", "  ")).toBe("");
  });
});

describe("RejectSubmissionDialog", () => {
  it("names the effect: final, and the member is told the reason", () => {
    render(ui({}));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Starry Night (1000)");
    expect(dialog.textContent).toContain("can't be approved later");
    expect(dialog.textContent).toContain("told the reason");
  });

  it("requires a reason before it rejects", async () => {
    const onReject = vi.fn((_reason: string) => Promise.resolve());
    render(ui({ onReject }));
    expect(rejectButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Not a jigsaw puzzle" }));
    expect(rejectButton().disabled).toBe(false);
    fireEvent.click(rejectButton());
    await waitFor(() => expect(onReject).toHaveBeenCalledTimes(1));
    expect(onReject).toHaveBeenCalledWith("Not a jigsaw puzzle");
  });

  it("preselects the duplicate it found and sends its title with the note", async () => {
    const onReject = vi.fn((_reason: string) => Promise.resolve());
    render(ui({ duplicateTitle: "Starry Night", onReject }));
    const duplicate = screen.getByRole<HTMLInputElement>("radio", {
      name: "Duplicate of “Starry Night”",
    });
    expect(duplicate.checked).toBe(true);

    fireEvent.change(note(), {
      target: { value: "Add your copy to that one." },
    });
    // The member's text is shown before it is sent.
    expect(screen.getByRole("dialog").textContent).toContain(
      "Duplicate of “Starry Night”. Add your copy to that one.",
    );
    fireEvent.click(rejectButton());
    await waitFor(() =>
      expect(onReject).toHaveBeenCalledWith(
        "Duplicate of “Starry Night”. Add your copy to that one.",
      ),
    );
  });

  it("offers a title-less duplicate reason when no match was found", () => {
    render(ui({}));
    const duplicate = screen.getByRole<HTMLInputElement>("radio", {
      name: "Already in the catalogue",
    });
    expect(duplicate.checked).toBe(false);
  });

  it("needs a note for Other, which is then the whole reason", async () => {
    const onReject = vi.fn((_reason: string) => Promise.resolve());
    render(ui({ onReject }));
    fireEvent.click(screen.getByRole("radio", { name: "Other reason" }));
    expect(rejectButton().disabled).toBe(true);
    expect(note().required).toBe(true);

    fireEvent.change(note(), { target: { value: "  " } });
    expect(rejectButton().disabled).toBe(true);
    fireEvent.change(note(), { target: { value: "It is a 3D puzzle." } });
    fireEvent.click(rejectButton());
    await waitFor(() =>
      expect(onReject).toHaveBeenCalledWith("It is a 3D puzzle."),
    );
  });

  it("caps the note", () => {
    render(ui({}));
    expect(note().maxLength).toBe(500);
  });

  it("says the submission was handled elsewhere and refuses to reject it", () => {
    render(ui({ duplicateTitle: "Starry Night", handledElsewhere: true }));
    expect(screen.getByRole("alert").textContent).toContain(
      "handled elsewhere",
    );
    expect(rejectButton().disabled).toBe(true);
  });

  it("speaks Dutch", () => {
    render(ui({ duplicateTitle: "Sterrennacht" }, "nl"));
    expect(
      screen.getByRole<HTMLInputElement>("radio", {
        name: "Duplicaat van “Sterrennacht”",
      }).checked,
    ).toBe(true);
    expect(screen.getByRole("radio", { name: "Geen legpuzzel" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Inzending afwijzen" }),
    ).toBeTruthy();
  });
});

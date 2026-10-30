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
  EditApproveDialog,
  type EditApproveValues,
} from "./edit-approve-dialog";
import type { PendingSubmission } from "./submission-detail";

// The maker suggestion pools are the only queries; they stay empty here.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: [] }),
}));

afterEach(cleanup);

const submission = {
  _id: "p1",
  aggregateId: "agg-1",
  title: "Starry Night",
  description: "",
  brand: "Ravensburger",
  publisher: "",
  pieceCount: 1000,
  difficulty: "medium",
  tags: [],
  createdAt: 0,
} as unknown as PendingSubmission;

type Props = {
  submission?: PendingSubmission;
  handledElsewhere?: boolean;
  onSave?: (values: EditApproveValues) => Promise<void>;
};
const ui = (
  { submission: s = submission, handledElsewhere = false, onSave }: Props,
  locale: "en" | "nl" = "en",
) => (
  <IntlProvider locale={locale} messages={locale === "en" ? en : nl}>
    <EditApproveDialog
      submission={s}
      open
      onOpenChange={vi.fn()}
      onSave={onSave ?? vi.fn(() => Promise.resolve())}
      busy={false}
      handledElsewhere={handledElsewhere}
    />
  </IntlProvider>
);

const titleInput = () =>
  screen.getByRole<HTMLInputElement>("textbox", { name: "Title" });

describe("EditApproveDialog", () => {
  it("starts from the submission it was opened for", () => {
    render(ui({}));
    expect(titleInput().value).toBe("Starry Night");
  });

  it("keeps the admin's edits when the submission's live data updates", () => {
    const { rerender } = render(ui({}));
    fireEvent.change(titleInput(), {
      target: { value: "Starry Night (1000)" },
    });

    // A reactive refresh hands the dialog a new object for the same submission.
    rerender(ui({ submission: { ...submission, brand: "Clementoni" } }));
    expect(titleInput().value).toBe("Starry Night (1000)");
  });

  it("saves the edited values", async () => {
    const onSave = vi.fn((_values: EditApproveValues) => Promise.resolve());
    render(ui({ onSave }));
    fireEvent.change(titleInput(), { target: { value: "Sterrennacht" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & Approve" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      title: "Sterrennacht",
      brand: "Ravensburger",
      pieceCount: 1000,
    });
  });

  it("says the submission was handled elsewhere and refuses to save it", () => {
    render(ui({ handledElsewhere: true }));
    expect(screen.getByRole("alert").textContent).toContain(
      "handled elsewhere",
    );
    expect(
      screen
        .getByRole<HTMLButtonElement>("button", { name: "Save & Approve" })
        .hasAttribute("disabled"),
    ).toBe(true);
    // The edits stay visible (and copyable).
    expect(titleInput().value).toBe("Starry Night");
  });

  it("says it in Dutch too", () => {
    render(ui({ handledElsewhere: true }, "nl"));
    expect(screen.getByRole("alert").textContent).toContain(
      "elders afgehandeld",
    );
  });
});

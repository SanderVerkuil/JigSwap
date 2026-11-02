// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import { EditCopyDialog } from "./edit-copy-dialog";

// The owner's copy editor: the visibility control writes through the same updateSharing call as
// the availability chips. Visibility is the owner's own choice (visibilityPreference): it stays
// selectable while the copy is offered, and an offer never rewrites it.

const calls = vi.hoisted(() => ({
  byMutation: {} as Record<string, Array<Record<string, unknown>>>,
  // A mutation name mapped to the error it rejects with.
  failWith: {} as Record<string, unknown>,
  toastError: vi.fn(),
}));

vi.mock("@/gateway", () => ({
  gateway: {
    library: {
      changeCondition: "changeCondition",
      updateSharing: "updateSharing",
      updateDetails: "updateDetails",
      setCopyCover: "setCopyCover",
    },
  },
}));

vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation:
    (name: string) => async (args: Record<string, unknown>) => {
      (calls.byMutation[name] ??= []).push(args);
      if (calls.failWith[name] !== undefined) throw calls.failWith[name];
    },
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (args: unknown) => Promise<unknown>;
  }) => ({ mutateAsync: mutationFn, isPending: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: calls.toastError },
}));

const CLOSED = { forTrade: false, forLend: false, forSale: false };

const copyOf = (
  availability: typeof CLOSED,
  visibility: "private" | "visible",
  visibilityPreference?: "private" | "visible",
  loans: Array<{ status: "open" | "returned" | "recalled" }> = [],
  acquisition: {
    acquisitionDate?: number;
    acquisitionSource?: "bought_new" | "bought_used" | "trade" | "gift";
  } = {},
) =>
  ({
    copyId: "row1",
    aggregateId: "agg1",
    gallery: [],
    loans,
    snapshot: {
      title: "Secret Garden",
      pieceCount: 1000,
      coverImageId: null,
      condition: "good",
      notes: undefined,
      availability,
      visibility,
      visibilityPreference,
      ...acquisition,
      tags: [],
    },
  }) as never;

const renderDialog = (copy: never) =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <EditCopyDialog open onOpenChange={() => {}} copy={copy} />
    </IntlProvider>,
  );

const radio = (name: string) =>
  screen.getByRole("radio", { name: new RegExp(name) });

const save = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => {});
};

beforeEach(() => {
  calls.byMutation = {};
  calls.failWith = {};
  calls.toastError.mockReset();
});
afterEach(() => cleanup());

describe("EditCopyDialog condition", () => {
  it("names the stored condition by the same word as the add form and can pick New (sealed)", async () => {
    renderDialog(copyOf(CLOSED, "visible", "visible"));
    const picker = screen.getByRole("radiogroup", { name: "Condition" });
    expect(
      Array.from(picker.querySelectorAll('[role="radio"]')).map(
        (r) => r.textContent,
      ),
    ).toEqual(["New (sealed)", "Like new", "Good", "Fair", "Poor"]);
    expect(radio("Good").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(radio("New \\(sealed\\)"));
    await save();
    expect(calls.byMutation.changeCondition).toEqual([
      { copyId: "agg1", condition: "new_sealed" },
    ]);
  });
});

describe("EditCopyDialog visibility", () => {
  it("an offered copy the owner keeps private shows Private, selectable, with the reason it is visible", () => {
    renderDialog(copyOf({ ...CLOSED, forTrade: true }, "visible", "private"));
    const privateOption = radio(
      "Private — only you and your household",
    ) as HTMLButtonElement;
    expect(privateOption.getAttribute("aria-checked")).toBe("true");
    expect(privateOption.disabled).toBe(false);
    expect(
      screen.getByText(
        "On offer, so it's visible for now. It goes back to private when you withdraw every offer.",
      ),
    ).toBeTruthy();
  });

  it("making a closed copy private sends one updateSharing with visibility private", async () => {
    renderDialog(copyOf(CLOSED, "visible", "visible"));
    expect(
      screen.getByText(
        "Offering a puzzle for swap, lend or sale makes it visible while the offer lasts.",
      ),
    ).toBeTruthy();
    fireEvent.click(radio("Private — only you and your household"));
    await save();
    expect(calls.byMutation.updateSharing).toEqual([
      { copyId: "agg1", visibility: "private", ...CLOSED },
    ]);
  });

  it("turning on an offer for a private copy keeps Private and saves the private choice", async () => {
    renderDialog(copyOf(CLOSED, "private", "private"));
    fireEvent.click(screen.getByRole("button", { name: "For Trade" }));
    expect(
      radio("Private — only you and your household").getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    await save();
    expect(calls.byMutation.updateSharing).toEqual([
      { copyId: "agg1", visibility: "private", ...CLOSED, forTrade: true },
    ]);
  });

  it("an offered copy can be made private without withdrawing the offer", async () => {
    renderDialog(copyOf({ ...CLOSED, forLend: true }, "visible", "visible"));
    fireEvent.click(radio("Private — only you and your household"));
    await save();
    expect(calls.byMutation.updateSharing).toEqual([
      { copyId: "agg1", visibility: "private", ...CLOSED, forLend: true },
    ]);
  });

  it("saving an offered private copy unchanged sends no sharing write", async () => {
    renderDialog(copyOf({ ...CLOSED, forTrade: true }, "visible", "private"));
    await save();
    expect(calls.byMutation.updateSharing).toBeUndefined();
  });

  it("without a preference (older backend) it starts from the effective visibility", () => {
    renderDialog(copyOf(CLOSED, "private"));
    expect(
      radio("Private — only you and your household").getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
  });

  it("saving without changes sends no sharing write", async () => {
    renderDialog(copyOf(CLOSED, "private", "private"));
    await save();
    expect(calls.byMutation.updateSharing).toBeUndefined();
  });
});

// The Library refuses a sharing change while the copy is held: an exchange in progress reserves it,
// or it is out on loan (CopyReserved). The member is told why, not just that saving failed.
describe("EditCopyDialog refusals", () => {
  it("says the puzzle is held when the sharing change is refused with CopyReserved", async () => {
    calls.failWith.updateSharing = new ConvexError({
      code: "CopyReserved",
      message: "x",
    });
    renderDialog(copyOf(CLOSED, "visible"));
    fireEvent.click(screen.getByRole("button", { name: "For Trade" }));
    await save();
    await vi.waitFor(() =>
      expect(calls.toastError).toHaveBeenCalledWith(
        en.copyInstance.editCopy.copyReserved,
      ),
    );
  });

  it("keeps the generic message for any other failure", async () => {
    calls.failWith.updateSharing = new Error("boom");
    renderDialog(copyOf(CLOSED, "visible"));
    fireEvent.click(screen.getByRole("button", { name: "For Trade" }));
    await save();
    await vi.waitFor(() =>
      expect(calls.toastError).toHaveBeenCalledWith(
        en.copyInstance.editCopy.editFailed,
      ),
    );
  });

  it("has the message in every locale file", () => {
    for (const messages of [en, nl, source]) {
      expect(messages.copyInstance.editCopy.copyReserved).toEqual(
        expect.any(String),
      );
      expect(messages.puzzles.deleteReserved).toEqual(expect.any(String));
    }
    expect(source.copyInstance.editCopy.copyReserved).toBe(
      en.copyInstance.editCopy.copyReserved,
    );
    expect(source.puzzles.deleteReserved).toBe(en.puzzles.deleteReserved);
  });
});

describe("EditCopyDialog cover picker", () => {
  it("shows each photo's small rendition when it has one, else the original", () => {
    const base = copyOf(CLOSED, "visible") as unknown as Record<
      string,
      unknown
    >;
    const photo = (id: string, extra: Record<string, unknown>) => ({
      id,
      url: `https://files.example/${id}-original`,
      caption: `Photo ${id}`,
      tag: null,
      description: null,
      takenAt: null,
      createdAt: 1,
      moderationStatus: "approved",
      ...extra,
    });
    renderDialog({
      ...base,
      gallery: [
        photo("a", {
          thumbUrl: "https://files.example/a-480",
          srcSet: "https://files.example/a-480 480w",
        }),
        photo("b", {}),
      ],
    } as never);

    const src = (name: string) =>
      screen
        .getByRole("button", { name })
        .querySelector("img")
        ?.getAttribute("src");
    expect(src("Photo a")).toBe("https://files.example/a-480");
    expect(src("Photo b")).toBe("https://files.example/b-original");
  });
});

// UX-60: with no photos the cover picker explains that photos unlock a custom cover; it now also
// offers the way to add one, which hands over to the page's photo picker and closes the editor.
describe("EditCopyDialog cover picker without photos", () => {
  it("offers Add photo, which starts the page's photo upload and closes the dialog", () => {
    const onOpenChange = vi.fn();
    const onAddPhotos = vi.fn();
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <EditCopyDialog
          open
          onOpenChange={onOpenChange}
          copy={copyOf(CLOSED, "visible")}
          onAddPhotos={onAddPhotos}
        />
      </IntlProvider>,
    );
    expect(
      screen.getByText("Add photos to this copy to choose a custom cover."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add photo" }));
    expect(onAddPhotos).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(calls.byMutation).toEqual({});
  });

  it("offers no Add photo once the copy has photos to choose from", () => {
    const withPhoto = {
      ...(copyOf(CLOSED, "visible") as object),
      gallery: [{ id: "img1", url: "https://example.test/1.jpg" }],
    } as never;
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <EditCopyDialog
          open
          onOpenChange={() => {}}
          copy={withPhoto}
          onAddPhotos={() => {}}
        />
      </IntlProvider>,
    );
    expect(screen.queryByRole("button", { name: "Add photo" })).toBeNull();
  });
});

describe("EditCopyDialog offers during a loan", () => {
  it("an open loan disables the offer chips and says why", () => {
    renderDialog(copyOf(CLOSED, "visible", "visible", [{ status: "open" }]));
    for (const name of ["For Trade", "For Loan", "For Sale"]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
    expect(
      screen.getByText("It's on loan. You can offer it again once it's back."),
    ).toBeTruthy();
  });

  it("an offer that is on during a loan can be withdrawn, and put back before saving", async () => {
    renderDialog(
      copyOf({ ...CLOSED, forSale: true }, "visible", "visible", [
        { status: "open" },
      ]),
    );
    const chip = (name: string) =>
      screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(chip("For Trade").disabled).toBe(true);
    expect(chip("For Sale").disabled).toBe(false);

    fireEvent.click(chip("For Sale"));
    expect(chip("For Sale").getAttribute("aria-pressed")).toBe("false");
    expect(chip("For Sale").disabled).toBe(false);

    await save();
    expect(calls.byMutation.updateSharing).toEqual([
      expect.objectContaining(CLOSED),
    ]);
  });

  it("a returned loan leaves the offer chips usable", () => {
    renderDialog(
      copyOf(CLOSED, "visible", "visible", [{ status: "returned" }]),
    );
    expect(
      (screen.getByRole("button", { name: "For Trade" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});

describe("EditCopyDialog acquisition", () => {
  const MARCH_17 = Date.UTC(2025, 2, 17, 9);
  const select = (name: string) =>
    screen.getByRole("combobox", { name }) as HTMLSelectElement;
  const choose = (name: string, value: string) =>
    fireEvent.change(select(name), { target: { value } });
  const saveButton = () =>
    screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;

  it("records the month, year and source it was acquired in", async () => {
    renderDialog(copyOf(CLOSED, "visible", "visible"));
    choose("Month acquired", "3");
    choose("Year acquired", "2025");
    choose("Source", "bought_used");
    await save();
    expect(calls.byMutation.updateDetails).toEqual([
      {
        copyId: "agg1",
        acquisition: { date: Date.UTC(2025, 2, 1, 12), source: "bought_used" },
      },
    ]);
  });

  it("shows what is stored and keeps the exact date when only the source changes", async () => {
    renderDialog(
      copyOf(CLOSED, "visible", "visible", [], {
        acquisitionDate: MARCH_17,
        acquisitionSource: "gift",
      }),
    );
    expect(select("Month acquired").value).toBe("3");
    expect(select("Year acquired").value).toBe("2025");
    expect(select("Source").value).toBe("gift");
    choose("Source", "trade");
    await save();
    expect(calls.byMutation.updateDetails).toEqual([
      { copyId: "agg1", acquisition: { date: MARCH_17, source: "trade" } },
    ]);
  });

  it("clearing the month and year removes the date", async () => {
    renderDialog(
      copyOf(CLOSED, "visible", "visible", [], {
        acquisitionDate: MARCH_17,
        acquisitionSource: "gift",
      }),
    );
    choose("Month acquired", "");
    choose("Year acquired", "");
    await save();
    expect(calls.byMutation.updateDetails).toEqual([
      { copyId: "agg1", acquisition: { source: "gift" } },
    ]);
  });

  it("a month without a year can't be saved, and says why", () => {
    renderDialog(copyOf(CLOSED, "visible", "visible"));
    choose("Month acquired", "3");
    expect(screen.getByText("Choose both a month and a year.")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    choose("Year acquired", "2024");
    expect(saveButton().disabled).toBe(false);
  });

  it("sends notes and acquisition in one write, and nothing when unchanged", async () => {
    renderDialog(copyOf(CLOSED, "visible", "visible"));
    await save();
    expect(calls.byMutation.updateDetails).toBeUndefined();

    cleanup();
    renderDialog(copyOf(CLOSED, "visible", "visible"));
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Box a bit dented" },
    });
    choose("Source", "bought_new");
    await save();
    expect(calls.byMutation.updateDetails).toEqual([
      {
        copyId: "agg1",
        notes: "Box a bit dented",
        acquisition: { source: "bought_new" },
      },
    ]);
  });
});

describe("EditCopyDialog starts from the copy as it is when opened", () => {
  const dialogFor = (open: boolean, copy: never) => (
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <EditCopyDialog open={open} onOpenChange={() => {}} copy={copy} />
    </IntlProvider>
  );

  it("an offer switched on after the page loaded is not withdrawn by saving the dialog", async () => {
    const { rerender } = render(
      dialogFor(false, copyOf(CLOSED, "visible", "visible")),
    );
    // The page's offer switch turned "For Trade" on; the live query re-renders the closed dialog.
    rerender(
      dialogFor(
        false,
        copyOf({ ...CLOSED, forTrade: true }, "visible", "visible"),
      ),
    );
    rerender(
      dialogFor(
        true,
        copyOf({ ...CLOSED, forTrade: true }, "visible", "visible"),
      ),
    );

    expect(
      screen
        .getByRole("button", { name: "For Trade" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Box a bit dented" },
    });
    await save();
    expect(calls.byMutation.updateSharing).toBeUndefined();
    expect(calls.byMutation.updateDetails).toEqual([
      { copyId: "agg1", notes: "Box a bit dented" },
    ]);
  });

  it("reopening drops edits that were cancelled", () => {
    const copy = copyOf(CLOSED, "visible", "visible");
    const { rerender } = render(dialogFor(true, copy));
    fireEvent.click(screen.getByRole("button", { name: "For Loan" }));
    rerender(dialogFor(false, copy));
    rerender(dialogFor(true, copy));
    expect(
      screen
        .getByRole("button", { name: "For Loan" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });
});

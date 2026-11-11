// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { CoverImageField, PuzzleDefinitionFields } from "./definition-fields";
import { formFromView, type ProposalFormState } from "./proposal-diff";

vi.mock("@/components/image-editor/lazy-image-editor-dialog", () => ({
  LazyImageEditorDialog: () => null,
}));

afterEach(cleanup);

const intl = (ui: ReactNode) => (
  <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
    {ui}
  </IntlProvider>
);

// The field set over a live form, as the suggest-edit and admin edit pages hold it.
function Fields() {
  const [form, setForm] = useState<ProposalFormState>(() =>
    formFromView({ title: "Café", pieceCount: 1000 }),
  );
  return (
    <PuzzleDefinitionFields
      form={form}
      set={(key, value) => setForm((f) => ({ ...f, [key]: value }))}
      categories={[]}
      difficultySeed=""
      shapeSeed=""
      idPrefix="se"
    />
  );
}

describe("CoverImageField", () => {
  // F41: a label around an sr-only input clipped its focus outline, so the control showed no focus.
  it("offers Replace image as a real button that opens the file picker", () => {
    render(
      intl(
        <CoverImageField
          currentImageUrl={undefined}
          imageStateLabel="Current image"
          onPickFile={() => {}}
        />,
      ),
    );
    const replace = screen.getByRole("button", {
      name: en.suggestEdit.replaceImage,
    });
    expect(replace.tagName).toBe("BUTTON");
    expect(replace.closest("label")).toBeNull();

    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.tabIndex).toBe(-1);
    const click = vi.spyOn(input, "click");
    fireEvent.click(replace);
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe("PuzzleDefinitionFields barcodes", () => {
  it.each([
    ["EAN", "4006381333930", en.forms["puzzle-form"].ean.invalid],
    ["UPC", "03600029145", en.forms["puzzle-form"].upc.invalid],
  ])(
    "says a wrong %s under the field once the member leaves it",
    (label, code, message) => {
      render(intl(<Fields />));
      const field = screen.getByLabelText(label);
      fireEvent.change(field, { target: { value: code } });
      expect(field.getAttribute("aria-invalid")).toBeNull();

      fireEvent.blur(field);
      expect(field.getAttribute("aria-invalid")).toBe("true");
      const hint = document.getElementById(
        field.getAttribute("aria-describedby")!,
      );
      expect(hint?.textContent).toBe(message);
      expect(hint?.className).toContain("text-destructive");
    },
  );

  it("takes a valid code and an empty field", () => {
    render(intl(<Fields />));
    const ean = screen.getByLabelText("EAN");
    fireEvent.change(ean, { target: { value: "4006381333931" } });
    fireEvent.blur(ean);
    expect(ean.getAttribute("aria-invalid")).toBeNull();

    const upc = screen.getByLabelText("UPC");
    fireEvent.blur(upc);
    expect(upc.getAttribute("aria-invalid")).toBeNull();
  });
});

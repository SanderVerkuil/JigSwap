// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import { CoverColourField } from "./cover-colour-field";

const UPLOAD = "blob:uploaded";

// The field as a form uses it: the form owns the selection (undefined = no photo) and an upload
// becomes the selected photo, like routes/_dashboard/my-puzzles/add/new.tsx does.
function Harness({ initial }: { initial?: string }) {
  const [selected, setSelected] = useState<string | undefined>(initial);
  const [uploaded, setUploaded] = useState(false);
  return (
    <>
      <CoverColourField
        photoOptions={[
          { url: "small.jpg" },
          { url: "large.jpg" },
          ...(uploaded ? [{ url: UPLOAD, uploaded: true }] : []),
        ]}
        selectedPhotoUrl={selected}
        onSelectPhoto={setSelected}
        onUploadPhoto={() => {
          setUploaded(true);
          setSelected(UPLOAD);
        }}
      />
      <output data-testid="selected">{selected ?? "none"}</output>
    </>
  );
}

const renderField = (initial?: string) =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <Harness initial={initial} />
    </IntlProvider>,
  );

const selected = () => screen.getByTestId("selected").textContent;

// Happy-dom decodes no images: report each thumbnail's natural size by hand.
const measure = (sizes: Record<string, number>) => {
  for (const img of document.querySelectorAll<HTMLImageElement>("img")) {
    const side = sizes[img.getAttribute("src") ?? ""];
    if (side === undefined) continue;
    Object.defineProperty(img, "naturalWidth", { value: side });
    Object.defineProperty(img, "naturalHeight", { value: side });
    act(() => {
      fireEvent.load(img);
    });
  }
};

const upload = () =>
  fireEvent.change(
    document.querySelector<HTMLInputElement>('input[type="file"]')!,
    { target: { files: [new File(["x"], "box.jpg", { type: "image/jpeg" })] } },
  );

afterEach(cleanup);

describe("CoverColourField", () => {
  it("offers photos and an upload, and no colour swatches", () => {
    renderField("small.jpg");
    // The two photos and the upload (a real button, UX-11).
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /colour/i })).toBeNull();
    expect(screen.getByText(en.puzzles.uploadPhoto)).toBeTruthy();
  });

  it("selects the sharpest imported photo once both are measured", () => {
    renderField("small.jpg");
    measure({ "small.jpg": 300, "large.jpg": 1200 });
    expect(selected()).toBe("large.jpg");
  });

  it("deselects the selected photo when pressed again, and does not re-pick one", () => {
    renderField("small.jpg");
    measure({ "small.jpg": 300, "large.jpg": 1200 });
    const best = screen.getByRole("button", { pressed: true });

    fireEvent.click(best);

    expect(selected()).toBe("none");
    expect(best.getAttribute("aria-pressed")).toBe("false");
    measure({ "small.jpg": 300, "large.jpg": 1200 });
    expect(selected()).toBe("none");
  });

  it("keeps the member's upload selected instead of swapping in an imported photo", () => {
    renderField("small.jpg");
    measure({ "small.jpg": 300, "large.jpg": 1200 });

    upload();

    expect(selected()).toBe(UPLOAD);
  });
});

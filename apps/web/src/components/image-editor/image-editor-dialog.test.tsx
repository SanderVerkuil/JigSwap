// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { forwardRef, useEffect, useImperativeHandle } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { ImageEditorDialog } from "./image-editor-dialog";

// The Apply wiring around export-choice: happy-dom has no canvas, so the
// cropper is a stand-in whose bake is a fixed JPEG and whose frame can be
// "dragged"; the canvas probe is mocked per test.

const mocks = vi.hoisted(() => ({ trusted: vi.fn(() => true) }));

vi.mock("@/lib/prepare-photo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/prepare-photo")>()),
  canvasCanBeTrusted: mocks.trusted,
}));

vi.mock("react-advanced-cropper", () => ({
  Cropper: forwardRef(function FakeCropper(
    props: { onReady?: () => void; onInteractionEnd?: () => void },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      rotateImage: () => {},
      getCanvas: () => ({
        toBlob: (resolve: BlobCallback) =>
          resolve(new Blob(["baked"], { type: "image/jpeg" })),
      }),
    }));
    const { onReady } = props;
    useEffect(() => onReady?.(), [onReady]);
    return (
      <button type="button" onClick={() => props.onInteractionEnd?.()}>
        drag frame
      </button>
    );
  }),
}));

// The picked file behind the object URL: a PNG by its magic bytes.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]);

const renderEditor = (onApply: (file: File) => void) =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <ImageEditorDialog
        src="blob:picked"
        fileName="photo.png"
        onApply={onApply}
        onClose={() => {}}
      />
    </IntlProvider>,
  );

const apply = () =>
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));

beforeEach(() => {
  mocks.trusted.mockReturnValue(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(PNG)),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ImageEditorDialog Apply", () => {
  it("hands back the canvas bake where canvas read-back can be trusted", async () => {
    const onApply = vi.fn();
    renderEditor(onApply);
    fireEvent.click(screen.getByRole("button", { name: "Rotate 90°" }));
    apply();
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    const file = onApply.mock.calls[0][0] as File;
    expect(file.type).toBe("image/jpeg");
    expect(await file.text()).toBe("baked");
  });

  it("hands back the original, typed by its bytes, for an unedited photo in a scrambling browser", async () => {
    mocks.trusted.mockReturnValue(false);
    const onApply = vi.fn();
    renderEditor(onApply);
    apply();
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    const file = onApply.mock.calls[0][0] as File;
    expect(file.name).toBe("photo.png");
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
  });

  it.each([
    ["rotated", "Rotate 90°"],
    ["cropped", "drag frame"],
  ])(
    "refuses a %s photo in a scrambling browser and offers the original",
    async (_name, edit) => {
      mocks.trusted.mockReturnValue(false);
      const onApply = vi.fn();
      renderEditor(onApply);
      fireEvent.click(screen.getByRole("button", { name: edit }));
      apply();

      expect((await screen.findByRole("alert")).textContent).toContain(
        en.imageEditor.editingBlocked,
      );
      expect(onApply).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Upload original" }));
      await waitFor(() => expect(onApply).toHaveBeenCalled());
      const file = onApply.mock.calls[0][0] as File;
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
    },
  );
});

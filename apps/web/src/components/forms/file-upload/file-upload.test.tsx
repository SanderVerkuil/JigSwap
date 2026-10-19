// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { FileUpload } from "./index";

// The generic image field re-encodes through the shared canvas step (lib/prepare-photo).

const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));

vi.mock("@/lib/prepare-photo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/prepare-photo")>()),
  preparePhoto: mocks.prepare,
}));

const renderField = (onChange: (value: unknown) => void) =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <FileUpload placeholder="Box art" onChange={onChange} />
    </IntlProvider>,
  );

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  mocks.prepare.mockReset();
});
afterEach(cleanup);

describe("FileUpload", () => {
  it("hands on the re-encoded JPEG under the picked name", async () => {
    mocks.prepare.mockResolvedValue({
      file: new Blob(["jpeg"], { type: "image/jpeg" }),
      width: 1024,
      height: 768,
    });
    const onChange = vi.fn();
    renderField(onChange);
    const picked = new File(["png with exif"], "box.png", {
      type: "image/png",
    });

    fireEvent.change(screen.getByPlaceholderText("Box art"), {
      target: { files: [picked] },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(mocks.prepare).toHaveBeenCalledWith(picked);
    const file = onChange.mock.calls[0][0] as File;
    expect(file.name).toBe("box.png");
    expect(file.type).toBe("image/jpeg");
    expect(await file.text()).toBe("jpeg");
  });

  it("shows the error when the browser cannot prepare the file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.prepare.mockRejectedValue(new Error("EncodingError"));
    const onChange = vi.fn();
    renderField(onChange);

    fireEvent.change(screen.getByPlaceholderText("Box art"), {
      target: { files: [new File(["?"], "x.heic", { type: "image/heic" })] },
    });

    expect(await screen.findByText(en.forms["file-upload"].error)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});

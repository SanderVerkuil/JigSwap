// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { BarcodeScanButton } from "./barcode-scan-button";

const mocks = vi.hoisted(() => ({
  detect: vi.fn<() => Promise<{ rawValue: string }[]>>(),
  getUserMedia: vi.fn<(constraints: unknown) => Promise<MediaStream>>(),
  stopTrack: vi.fn(),
  toastError: vi.fn<(message: string) => void>(),
  coarse: true,
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

class FakeBarcodeDetector {
  constructor(readonly options: { formats: string[] }) {}
  detect = mocks.detect;
}

const fakeStream = () =>
  ({ getTracks: () => [{ stop: mocks.stopTrack }] }) as unknown as MediaStream;

beforeEach(() => {
  mocks.detect.mockReset().mockResolvedValue([]);
  mocks.getUserMedia.mockReset().mockResolvedValue(fakeStream());
  mocks.stopTrack.mockReset();
  mocks.toastError.mockReset();
  mocks.coarse = true;
  vi.stubGlobal("BarcodeDetector", FakeBarcodeDetector);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)" && mocks.coarse,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: mocks.getUserMedia },
  });
  // happy-dom has no camera: a no-op preview stands in for the real video element.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "srcObject", "set").mockImplementation(
    () => {},
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderButton = () => {
  const onScan = vi.fn<(code: string) => void>();
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <BarcodeScanButton onScan={onScan} />
    </IntlProvider>,
  );
  return { onScan };
};

const openScanner = () =>
  fireEvent.click(screen.getByRole("button", { name: "Scan a barcode" }));

describe("BarcodeScanButton", () => {
  it("renders nothing on the server", () => {
    const html = renderToStaticMarkup(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <BarcodeScanButton onScan={() => {}} />
      </IntlProvider>,
    );
    expect(html).toBe("");
  });

  it("renders nothing where the browser has no BarcodeDetector", () => {
    vi.stubGlobal("BarcodeDetector", undefined);
    renderButton();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing with a mouse (fine pointer)", () => {
    mocks.coarse = false;
    renderButton();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens the back camera and fills in the first EAN/UPC it sees, then stops the camera", async () => {
    mocks.detect
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ rawValue: "12345" }])
      .mockResolvedValue([{ rawValue: "4006381333931" }]);
    const { onScan } = renderButton();
    openScanner();
    expect(screen.getByRole("dialog", { name: "Scan a barcode" })).toBeTruthy();

    await waitFor(() => expect(onScan).toHaveBeenCalledWith("4006381333931"));
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(mocks.getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: "environment" },
      audio: false,
    });
    expect(mocks.stopTrack).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("stops the camera when the dialog is closed without a scan", async () => {
    renderButton();
    openScanner();
    await waitFor(() => expect(mocks.detect).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(mocks.stopTrack).toHaveBeenCalled());
  });

  it("explains a blocked camera and closes", async () => {
    mocks.getUserMedia.mockRejectedValue(
      new DOMException("denied", "NotAllowedError"),
    );
    const { onScan } = renderButton();
    openScanner();
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Camera access is blocked. Allow it in your browser settings, or type the barcode.",
      ),
    );
    expect(onScan).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says when the camera can't start for another reason", async () => {
    mocks.getUserMedia.mockRejectedValue(
      new DOMException("busy", "NotReadableError"),
    );
    renderButton();
    openScanner();
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't start the camera. Type the barcode instead.",
      ),
    );
  });
});

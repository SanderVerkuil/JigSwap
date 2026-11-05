// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { LazyImageEditorDialog } from "./lazy-image-editor-dialog";

// Stands in for the chunk with the cropper: counts its loads and can fail like a dropped network.
// A load that worked stays cached for the file, so the tests run in the order a page goes through.
const chunk = vi.hoisted(() => ({ loads: 0, offline: false }));

vi.mock("./image-editor-dialog", async () => {
  chunk.loads++;
  if (chunk.offline) throw new Error("Failed to fetch dynamically imported");
  return {
    ImageEditorDialog: ({ src }: { src: string | null }) => (
      <div data-testid="editor">{src ?? "closed"}</div>
    ),
  };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const page = (src: string | null, onClose = () => {}) => (
  <IntlProvider locale="en" messages={en}>
    <LazyImageEditorDialog
      src={src}
      fileName="photo.jpg"
      onApply={() => {}}
      onClose={onClose}
    />
  </IntlProvider>
);

afterEach(cleanup);

describe("LazyImageEditorDialog", () => {
  it("downloads nothing and renders nothing until an image is picked", async () => {
    const { container } = render(page(null));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(chunk.loads).toBe(0);
    expect(container.innerHTML).toBe("");
  });

  it("says so and closes when the editor can't load, and tries again on the next pick", async () => {
    chunk.offline = true;
    const onClose = vi.fn();
    const { rerender } = render(page("blob:one", onClose));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      en.imageEditor.loadFailed,
    );
    expect(screen.queryByTestId("editor")).toBeNull();

    rerender(page(null, onClose));
    chunk.offline = false;
    rerender(page("blob:two", onClose));
    expect((await screen.findByTestId("editor")).textContent).toBe("blob:two");
  });

  it("stays mounted once loaded, so the dialog can animate closed and reopen at once", async () => {
    const { rerender } = render(page("blob:three"));
    expect((await screen.findByTestId("editor")).textContent).toBe(
      "blob:three",
    );
    rerender(page(null));
    expect(screen.getByTestId("editor").textContent).toBe("closed");
    rerender(page("blob:four"));
    expect(screen.getByTestId("editor").textContent).toBe("blob:four");
  });
});

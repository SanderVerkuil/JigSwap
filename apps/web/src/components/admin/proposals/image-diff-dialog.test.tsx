// @vitest-environment happy-dom
// UX-60: on a phone both proposal images fit one screen with the title and the toggle, stacked at
// 32dvh each; from sm they sit side by side at the desktop height.
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { ImageDiffDialog } from "./image-diff-dialog";

afterEach(cleanup);

describe("ImageDiffDialog", () => {
  it("caps each image so both fit a phone screen, keeping the desktop height from sm", () => {
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <ImageDiffDialog
          open
          onOpenChange={vi.fn()}
          currentUrl="https://img.test/current.jpg"
          proposedUrl="https://img.test/proposed.jpg"
          title="Cover"
        />
      </IntlProvider>,
    );
    const images = Array.from(
      screen.getByRole("dialog").querySelectorAll("img"),
    );
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.className.split(/\s+/)).toEqual(
        expect.arrayContaining(["max-h-[32dvh]", "sm:max-h-[60vh]"]),
      );
    }
    expect(images[0]?.parentElement?.parentElement?.className).toContain(
      "sm:grid-cols-2",
    );
  });
});

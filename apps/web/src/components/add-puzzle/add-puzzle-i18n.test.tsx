// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { CoverColourField } from "./cover-colour-field";
import { LivePreviewCard, ReadinessChecklist } from "./live-preview-card";
import { TagInput } from "./tag-input";

afterEach(cleanup);

// The add-puzzle form's own labels and placeholders follow the app language (UX-64).
const catalogs = { en, nl } as const;
function inLocale(locale: keyof typeof catalogs) {
  return function LocaleWrapper({ children }: { children: ReactNode }) {
    return (
      <IntlProvider
        locale={locale}
        messages={catalogs[locale]}
        timeZone="Europe/Amsterdam"
      >
        {children}
      </IntlProvider>
    );
  };
}

const fill = (template: string, value: string) =>
  template.replace(/\{\w+\}/, value);

describe.each(["en", "nl"] as const)("add-puzzle strings in %s", (locale) => {
  const messages = catalogs[locale];
  const noop = () => {};

  it("names the tag field and each tag's remove button", () => {
    render(<TagInput value={["ocean"]} onChange={noop} placeholder="" />, {
      wrapper: inLocale(locale),
    });
    expect(
      screen.getByRole("textbox", { name: messages.common.tags }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: fill(messages.common.removeTag, "ocean"),
      }),
    ).toBeTruthy();
  });

  it("names the cover photo options, uploaded and measured", () => {
    render(
      <CoverColourField
        photoOptions={[
          { url: "https://img.test/box.jpg" },
          { url: "blob:mine", uploaded: true },
        ]}
        onSelectPhoto={noop}
        onUploadPhoto={noop}
      />,
      { wrapper: inLocale(locale) },
    );
    expect(
      screen.getByRole("button", { name: messages.puzzles.coverPhotoUploaded }),
    ).toBeTruthy();

    const thumb = document.querySelector<HTMLImageElement>(
      "img[src='https://img.test/box.jpg']",
    )!;
    Object.defineProperty(thumb, "naturalWidth", { value: 1200 });
    Object.defineProperty(thumb, "naturalHeight", { value: 800 });
    fireEvent.load(thumb);
    const size = messages.puzzles.coverPhotoSize
      .replace("{width}", "1200")
      .replace("{height}", "800");
    expect(
      screen.getByRole("button", {
        name: `${messages.puzzles.coverPhoto}, ${size}`,
      }),
    ).toBeTruthy();
  });

  it("shows translated placeholders in the empty preview", () => {
    render(
      <LivePreviewCard
        title=""
        brand=""
        pieceCount={undefined}
        available={false}
      />,
      { wrapper: inLocale(locale) },
    );
    expect(
      screen.getByText(messages.puzzles.previewTitlePlaceholder),
    ).toBeTruthy();
    expect(
      screen.getByText(messages.puzzles.previewBrandPlaceholder),
    ).toBeTruthy();
  });

  it("tells screen readers which checklist items are done", () => {
    render(
      <ReadinessChecklist
        items={[
          { ok: true, label: "Title" },
          { ok: false, label: "Brand" },
        ]}
      />,
      { wrapper: inLocale(locale) },
    );
    const done = screen.getByText("Title");
    const open = screen.getByText("Brand");
    expect(within(done).getByText(messages.puzzles.checkDone)).toBeTruthy();
    expect(within(open).getByText(messages.puzzles.checkNotDone)).toBeTruthy();
  });
});

// The cover's own-photo upload must work from the keyboard (UX-11): a real button that opens the
// file input, never a <label> wrapped around a display:none input.
describe("cover photo upload", () => {
  it("is a keyboard-reachable button, not a label around a hidden input", () => {
    render(
      <CoverColourField
        photoOptions={[]}
        onSelectPhoto={() => {}}
        onUploadPhoto={() => {}}
      />,
      { wrapper: inLocale("en") },
    );
    const upload = screen.getByRole("button", {
      name: en.puzzles.uploadPhoto,
    });
    expect(upload.closest("label")).toBeNull();
    const input =
      document.querySelector<HTMLInputElement>("input[type='file']")!;
    expect(input.closest("label")).toBeNull();
    expect(input.className.split(" ")).not.toContain("hidden");
  });
});

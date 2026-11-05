// @vitest-environment happy-dom
import type { ImportState } from "@/components/puzzle-import/use-puzzle-import";
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { ImportZone } from "./import-zone";

// The import action itself is out of scope: the zone renders whatever state the hook reports.
const mocks = vi.hoisted(() => ({
  state: { status: "idle" } as ImportState,
}));
vi.mock("@/components/puzzle-import/use-puzzle-import", () => ({
  usePuzzleImport: () => ({ state: mocks.state, run: vi.fn(), reset: vi.fn() }),
}));

const renderZone = (state: ImportState) => {
  mocks.state = state;
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <ImportZone onDraft={() => {}} onMatch={() => {}} />
    </IntlProvider>,
  );
};

afterEach(cleanup);

describe("ImportZone", () => {
  it("names the URL field for assistive tech, not only by its placeholder", () => {
    renderZone({ status: "idle" });
    expect(
      screen.getByRole("textbox", { name: en.puzzles.importUrlPlaceholder }),
    ).toBeTruthy();
  });

  it("keeps an empty live status region mounted before any import", () => {
    renderZone({ status: "idle" });
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("");
  });

  it("announces a failed import in the live region", () => {
    renderZone({ status: "error", reason: "failed" });
    expect(screen.getByRole("status").textContent).toContain(
      en.puzzles.importFailed,
    );
  });

  it("announces imported details in the live region", () => {
    renderZone({
      status: "ready",
      draft: { title: "Café", sourceUrl: "https://shop.example/cafe" },
      match: null,
    });
    expect(screen.getByRole("status").textContent).toContain(
      en.puzzles.importImported,
    );
  });
});

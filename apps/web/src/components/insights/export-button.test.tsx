// @vitest-environment happy-dom
import { EXPORT_SECTIONS } from "@jigswap/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { ExportButton, ExportDataButton, useDataExport } from "./export-button";

type PageArgs = { section: string; cursor: string | null };

const mocks = vi.hoisted(() => ({
  query: vi.fn<(ref: unknown, args: PageArgs) => Promise<unknown>>(),
  success: vi.fn(),
  error: vi.fn(),
  downloads: [] as string[],
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useConvex: () => ({ query: mocks.query }),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));

// The downloaded file: captured from the object URL the export creates.
let downloaded: Blob | null = null;

const withIntl = (node: React.ReactNode) => (
  <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
    {node}
  </IntlProvider>
);

// A caller that runs the export from its own control, like the command palette does.
function RunExport() {
  const { exportData, busy } = useDataExport();
  return (
    <button type="button" disabled={busy} onClick={() => void exportData()}>
      run
    </button>
  );
}

beforeEach(() => {
  downloaded = null;
  mocks.query.mockReset();
  mocks.success.mockReset();
  mocks.error.mockReset();
  mocks.downloads = [];
  URL.createObjectURL = (file: Blob | MediaSource) => {
    downloaded = file as Blob;
    return "blob:export";
  };
  URL.revokeObjectURL = () => {};
  // Record the download instead of letting the DOM navigate.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    mocks.downloads.push(this.download);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const page = (rows: unknown[], isDone: boolean, continueCursor = "") => ({
  rows,
  isDone,
  continueCursor,
});

describe("useDataExport", () => {
  it("reads every section page by page to its end and downloads all of it", async () => {
    mocks.query.mockImplementation(async (_ref, { section, cursor }) => {
      if (section === "account") {
        return page([{ user: { email: "me@example.com" } }], true);
      }
      if (section === "goals") {
        return cursor === null
          ? page([{ id: "goal-1" }], false, "after-goal-1")
          : page([{ id: "goal-2" }], true);
      }
      return page([], true);
    });
    render(withIntl(<RunExport />));
    fireEvent.click(screen.getByRole("button", { name: "run" }));

    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.success).toHaveBeenCalledWith(
      "Your data has been downloaded.",
    );
    expect(mocks.error).not.toHaveBeenCalled();

    const calls = mocks.query.mock.calls.map(([, args]) => args);
    expect(new Set(calls.map((c) => c.section))).toEqual(
      new Set(EXPORT_SECTIONS),
    );
    expect(calls.filter((c) => c.section === "goals")).toEqual([
      { section: "goals", cursor: null },
      { section: "goals", cursor: "after-goal-1" },
    ]);

    const file = JSON.parse(await downloaded!.text()) as Record<
      string,
      unknown
    >;
    for (const section of EXPORT_SECTIONS) {
      expect(file[section], section).toBeInstanceOf(Array);
    }
    expect(file.goals).toEqual([{ id: "goal-1" }, { id: "goal-2" }]);
    expect(file.account).toEqual([{ user: { email: "me@example.com" } }]);
    expect(mocks.downloads).toHaveLength(1);
    expect(mocks.downloads[0]).toMatch(
      /^jigswap-export-\d{4}-\d{2}-\d{2}\.json$/,
    );
    expect(
      (screen.getByRole("button", { name: "run" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("reports a failed page and downloads nothing", async () => {
    mocks.query.mockImplementation(async (_ref, { section }) => {
      if (section === "messagesSent") throw new Error("boom");
      return page([], true);
    });
    render(withIntl(<RunExport />));
    fireEvent.click(screen.getByRole("button", { name: "run" }));

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        "Could not export your data. Please try again.",
      ),
    );
    expect(downloaded).toBeNull();
    expect(mocks.downloads).toHaveLength(0);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "run" })).toHaveProperty(
      "disabled",
      false,
    );
  });
});

describe("ExportDataButton", () => {
  it("shows its progress while it reads and can't be started twice", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.query.mockImplementation(async (_ref, { section }) => {
      if (section === "copies") await held;
      return page([], true);
    });
    render(withIntl(<ExportDataButton />));
    fireEvent.click(screen.getByRole("button", { name: "Export my data" }));

    // "account" and "pushDevices" are read; "copies" is still loading.
    const busy = await screen.findByRole("button", {
      name: `Preparing… ${Math.round((2 / EXPORT_SECTIONS.length) * 100)}%`,
    });
    expect((busy as HTMLButtonElement).disabled).toBe(true);

    release();
    await screen.findByRole("button", { name: "Export my data" });
    expect(mocks.query).toHaveBeenCalledTimes(EXPORT_SECTIONS.length);
    expect(mocks.downloads).toHaveLength(1);
  });
});

describe("ExportButton", () => {
  it("keeps the Insights footer with its heading and the export action", () => {
    render(withIntl(<ExportButton />));
    expect(
      screen.getByRole("heading", { name: "Export my data" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Export my data" }),
    ).toBeDefined();
  });
});

// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import type { PresenceSettingsView } from "@jigswap/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  PresenceSharePrompt,
  PresenceSharingSetting,
} from "./presence-sharing";

const mocks = vi.hoisted(() => ({
  settings: undefined as PresenceSettingsView | undefined,
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastError: vi.fn(),
}));

vi.mock("./use-presence", () => ({
  usePresenceSettings: () => mocks.settings,
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

const SET = getFunctionName(gateway.social.setPresencePreferences);

const renderWith = (ui: React.ReactNode, locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      {ui}
    </IntlProvider>,
  );

beforeEach(() => {
  mocks.settings = { share: null, override: "auto" };
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.toastError.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(cleanup);

describe("PresenceSharePrompt", () => {
  it("Share stores share: true and hides the card", async () => {
    renderWith(<PresenceSharePrompt />);
    expect(screen.getByText("Show when you're online?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(mocks.mutation).toHaveBeenCalledWith(SET, { share: true });
    expect(screen.queryByText("Show when you're online?")).toBeNull();
  });

  it("Not now stores share: false", () => {
    renderWith(<PresenceSharePrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(mocks.mutation).toHaveBeenCalledWith(SET, { share: false });
  });

  it("speaks Dutch", () => {
    renderWith(<PresenceSharePrompt />, "nl");
    expect(screen.getByText("Laten zien wanneer je online bent?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Niet nu" }));
    expect(mocks.mutation).toHaveBeenCalledWith(SET, { share: false });
  });

  it("comes back with an error toast when saving fails", async () => {
    mocks.mutation.mockRejectedValueOnce(new Error("offline"));
    renderWith(<PresenceSharePrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't save your choice. Try again.",
      ),
    );
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });

  it.each<[string, PresenceSettingsView | undefined]>([
    ["still loading", undefined],
    ["already sharing", { share: true, override: "auto" }],
    ["already declined", { share: false, override: "auto" }],
  ])("is not shown when %s", (_label, settings) => {
    mocks.settings = settings;
    const { container } = renderWith(<PresenceSharePrompt />);
    expect(container.innerHTML).toBe("");
  });
});

describe("PresenceSharingSetting", () => {
  it("reflects and toggles the sharing choice", () => {
    mocks.settings = { share: false, override: "auto" };
    renderWith(<PresenceSharingSetting />);
    const toggle = screen.getByRole("switch", {
      name: "Show when I'm online to people I follow mutually. If off, you won't see others' status either.",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(mocks.mutation).toHaveBeenCalledWith(SET, { share: true });
  });

  it("is on when sharing, and turning it off stores false", () => {
    mocks.settings = { share: true, override: "away" };
    renderWith(<PresenceSharingSetting />, "nl");
    const toggle = screen.getByRole("switch", {
      name: "Laat zien wanneer ik online ben aan mensen die we wederzijds volgen. Als dit uit staat, zie jij ook niet of anderen online zijn.",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(mocks.mutation).toHaveBeenCalledWith(SET, { share: false });
  });
});

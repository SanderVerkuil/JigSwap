// @vitest-environment happy-dom
import { gateway } from "@/gateway";
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
import { MessagePreviewSettings } from "./message-preview-settings";

const mocks = vi.hoisted(() => ({
  previews: undefined as { email: boolean; push: boolean } | undefined,
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastError: vi.fn(),
}));

vi.mock("@/compat/clerk", () => ({ useUser: () => ({ user: { id: "u1" } }) }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: mocks.previews }),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

const SET = getFunctionName(gateway.notifications.setMessagePreview);

const renderSettings = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <MessagePreviewSettings />
    </IntlProvider>,
  );

const switchNamed = (name: string) =>
  screen.getByRole("switch", { name }) as HTMLButtonElement;

beforeEach(() => {
  mocks.previews = { email: false, push: true };
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("MessagePreviewSettings", () => {
  it("shows the member's choice per channel", () => {
    renderSettings();
    expect(
      switchNamed("Show message text in emails").getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      switchNamed("Show message text in push notifications").getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
  });

  it("flipping a switch saves that channel only", () => {
    renderSettings();
    fireEvent.click(switchNamed("Show message text in emails"));
    expect(mocks.mutation).toHaveBeenCalledWith(SET, {
      channel: "email",
      enabled: true,
    });
    fireEvent.click(switchNamed("Show message text in push notifications"));
    expect(mocks.mutation).toHaveBeenLastCalledWith(SET, {
      channel: "push",
      enabled: false,
    });
  });

  it("disables both switches while the setting loads", () => {
    mocks.previews = undefined;
    renderSettings();
    expect(switchNamed("Show message text in emails").disabled).toBe(true);
    expect(
      switchNamed("Show message text in push notifications").disabled,
    ).toBe(true);
  });

  it("tells the member when saving fails", async () => {
    mocks.mutation.mockRejectedValue(new Error("offline"));
    renderSettings();
    fireEvent.click(switchNamed("Show message text in emails"));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
  });

  it("is translated into Dutch", () => {
    renderSettings("nl");
    expect(switchNamed("Berichttekst tonen in e-mails")).toBeTruthy();
    expect(switchNamed("Berichttekst tonen in pushmeldingen")).toBeTruthy();
  });
});

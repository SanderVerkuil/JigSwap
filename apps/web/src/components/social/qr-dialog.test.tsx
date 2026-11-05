// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { QrDialogAutoOpen } from "./qr-dialog";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  writeText: vi.fn<(text: string) => Promise<void>>(),
  toastError: vi.fn<(message: string) => void>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children?: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

const MY_INVITE_LINK = getFunctionName(gateway.social.myInviteLink);

const renderDialog = (username: string | null, handle?: string) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <QrDialogAutoOpen
          memberId="m1"
          displayName="Mara"
          username={username}
          handle={handle}
          title="Anyone else here?"
          body="Show them this code."
          onClose={() => {}}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );

const status = () =>
  screen.getAllByRole("status").find((el) => el.getAttribute("aria-live"));

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue({ token: "tok" });
  mocks.writeText.mockReset().mockResolvedValue(undefined);
  mocks.toastError.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: mocks.writeText },
    configurable: true,
  });
});
afterEach(cleanup);

describe("QR dialog", () => {
  it("asks for a username first and mints no invite link meanwhile", async () => {
    renderDialog(null);
    expect(await screen.findByText(en.invite.needUsernameTitle)).toBeTruthy();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  // The caption shows the canonical handle (SEC-07), so a slug is enough without a username.
  it("doesn't ask for a username when a custom link already gives a readable handle", async () => {
    renderDialog(null, "mara-puzzles");
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(MY_INVITE_LINK, {}),
    );
    expect(screen.queryByText(en.invite.needUsernameTitle)).toBeNull();
    expect(screen.getByText(/\/members\/mara-puzzles$/)).toBeTruthy();
  });

  it("asks when the only handle is the bare member id", async () => {
    renderDialog(null, "m1");
    expect(await screen.findByText(en.invite.needUsernameTitle)).toBeTruthy();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("fetches the invite link once there is a username, and says what Copy and Share send", async () => {
    renderDialog("mara");
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(MY_INVITE_LINK, {}),
    );
    expect(screen.getByText(en.invite.inviteLinkHint)).toBeTruthy();
  });

  it("says Copied only after the clipboard accepted the link, and announces it", async () => {
    renderDialog("mara");
    const copy = await screen.findByRole("button", { name: "Copy link" });
    await waitFor(() => expect(copy.hasAttribute("disabled")).toBe(false));
    fireEvent.click(copy);

    await waitFor(() =>
      expect(mocks.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/members/m1?invite=tok`,
      ),
    );
    await waitFor(() => expect(status()?.textContent).toBe("Copied!"));
    expect(screen.getByRole("button", { name: "Copied!" })).toBeTruthy();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("shows an error, not Copied, when the clipboard refuses", async () => {
    mocks.writeText.mockRejectedValue(new Error("NotAllowedError"));
    renderDialog("mara");
    const copy = await screen.findByRole("button", { name: "Copy link" });
    await waitFor(() => expect(copy.hasAttribute("disabled")).toBe(false));
    fireEvent.click(copy);

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(en.invite.copyError),
    );
    expect(screen.queryByText("Copied!")).toBeNull();
    expect(status()?.textContent).toBe("");
  });
});

describe("QrDialog caption", () => {
  it("shows the server's canonical handle, not the username (SEC-07)", async () => {
    renderDialog("mara", "m1");
    await waitFor(() =>
      expect(screen.getByText(/\/members\/m1$/)).toBeTruthy(),
    );
    expect(screen.queryByText(/\/members\/mara/)).toBeNull();
  });

  it("hides the caption when no handle is known", async () => {
    renderDialog("mara");
    await waitFor(() =>
      expect(screen.getByText(en.invite.scanHint)).toBeTruthy(),
    );
    expect(screen.queryByText(/\/members\//)).toBeNull();
  });
});

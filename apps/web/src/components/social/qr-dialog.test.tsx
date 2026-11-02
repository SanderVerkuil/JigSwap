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
  Link: ({
    to,
    search,
    onClick,
    children,
  }: {
    to: string;
    search?: { edit?: string };
    onClick?: () => void;
    children?: ReactNode;
  }) => (
    <a
      href={search?.edit ? `${to}?edit=${search.edit}` : to}
      onClick={(event) => {
        event.preventDefault();
        onClick?.();
      }}
    >
      {children}
    </a>
  ),
}));

const MY_INVITE_LINK = getFunctionName(gateway.social.myInviteLink);

const renderDialog = (
  username: string | null,
  handle?: string,
  onClose: () => void = () => {},
) =>
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
          onClose={onClose}
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
  // The code carries the member id and the token, so nothing about it needs a username.
  it("shows the code without a username: no caption, and a custom link stays optional", async () => {
    renderDialog(null);
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(MY_INVITE_LINK, {}),
    );
    const copy = await screen.findByRole("button", { name: "Copy link" });
    await waitFor(() => expect(copy.hasAttribute("disabled")).toBe(false));
    expect(screen.getByText(en.invite.customLinkNote)).toBeTruthy();
    expect(screen.queryByText(/\/members\//)).toBeNull();
  });

  it("treats a bare member id as no handle: no caption", async () => {
    renderDialog(null, "m1");
    await screen.findByText(en.invite.customLinkNote);
    expect(screen.queryByText(/\/members\//)).toBeNull();
  });

  it("links to the custom-link field on /profile, closing the dialog on the way", async () => {
    const onClose = vi.fn();
    renderDialog(null, undefined, onClose);
    const link = await screen.findByRole("link", {
      name: en.invite.setCustomLink,
    });
    expect(link.getAttribute("href")).toBe("/profile?edit=link");
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });

  // The caption shows the canonical handle (SEC-07), so a slug is enough without a username.
  it("shows a custom link's address and no prompt to set one", async () => {
    renderDialog(null, "mara-puzzles");
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(MY_INVITE_LINK, {}),
    );
    expect(screen.queryByText(en.invite.customLinkNote)).toBeNull();
    expect(screen.getByText(/\/members\/mara-puzzles$/)).toBeTruthy();
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

describe("QR card while the link is on its way or refused", () => {
  it("shows a loading state, never a blank card, while the link is fetched", async () => {
    mocks.mutation.mockReturnValue(new Promise<never>(() => {}));
    renderDialog("mara");
    expect(
      await screen.findByRole("status", { name: en.common.loading }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Copy link" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("says so when the link can't be fetched, and Try again asks again", async () => {
    mocks.mutation.mockRejectedValueOnce(new Error("offline"));
    renderDialog("mara");
    expect((await screen.findByRole("alert")).textContent).toContain(
      en.invite.linkError,
    );
    // Nothing to scan or copy, so the hints and actions about the code are gone too.
    expect(screen.queryByText(en.invite.scanHint)).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: en.invite.retry }));
    await waitFor(() =>
      expect(screen.getByText(en.invite.scanHint)).toBeTruthy(),
    );
    expect(mocks.mutation).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("QrDialog caption", () => {
  it("shows the server's canonical handle, not the username (SEC-07)", async () => {
    renderDialog("mara", "mara-puzzles");
    await waitFor(() =>
      expect(screen.getByText(/\/members\/mara-puzzles$/)).toBeTruthy(),
    );
    expect(screen.queryByText(/\/members\/mara$/)).toBeNull();
  });

  // Another member holds the username as a slug, so the canonical handle is the bare id: that reads
  // as nothing to a visitor, and the username must not stand in for it either.
  it("hides the caption when the canonical handle is the bare id", async () => {
    renderDialog("mara", "m1");
    await screen.findByText(en.invite.scanHint);
    expect(screen.queryByText(/\/members\//)).toBeNull();
  });

  it("hides the caption when no handle is known", async () => {
    renderDialog("mara");
    await waitFor(() =>
      expect(screen.getByText(en.invite.scanHint)).toBeTruthy(),
    );
    expect(screen.queryByText(/\/members\//)).toBeNull();
  });
});

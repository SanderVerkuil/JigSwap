// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { InviteShareButtons } from "./invite-share-actions";

const mocks = vi.hoisted(() => ({
  toastError: vi.fn<(message: string) => void>(),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

const URL_ = "https://jigswap.site/members/m1?invite=abc";

const setClipboard = (writeText: (text: string) => Promise<void>) =>
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

const renderButtons = (onShared = vi.fn()) => {
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <InviteShareButtons
        url={URL_}
        kind="network"
        canShare={false}
        onShared={onShared}
      />
    </IntlProvider>,
  );
  return onShared;
};

const copyButton = () =>
  screen.getByRole("button", { name: en.invite.copyLink });

beforeEach(() => {
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("InviteShareButtons' copy", () => {
  it('says "Copied" and counts as shared only once the clipboard took the link', async () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    const onShared = renderButtons();

    fireEvent.click(copyButton());

    expect(
      await screen.findByRole("button", { name: en.invite.copied }),
    ).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(URL_);
    expect(onShared).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("says so when the clipboard refuses, and doesn't claim it was copied", async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    const onShared = renderButtons();

    fireEvent.click(copyButton());

    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(en.invite.copyError),
    );
    expect(copyButton()).toBeTruthy();
    expect(onShared).not.toHaveBeenCalled();
  });
});

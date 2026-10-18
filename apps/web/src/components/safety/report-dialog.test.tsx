// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { ReportDialog, type ReportTarget } from "./report-dialog";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const FILE = getFunctionName(gateway.reports.fileReport);
const BLOCK = getFunctionName(gateway.social.blockMember);
const MARA = "member_mara" as Id<"users">;

const MESSAGE: ReportTarget = {
  kind: "message",
  id: "msg_1",
  snippet: "Send me your address now",
};

const renderDialog = (
  target: ReportTarget = MESSAGE,
  memberId: Id<"users"> | null = MARA,
) => {
  const onBlocked = vi.fn();
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <ReportDialog
        target={target}
        name="Mara"
        memberId={memberId ?? undefined}
        open
        onOpenChange={vi.fn()}
        onBlocked={onBlocked}
      />
    </IntlProvider>,
  );
  return { onBlocked };
};

const submitButton = () => screen.getByRole("button", { name: "Send report" });
const alsoBlock = () =>
  screen.getByRole("checkbox", { name: "Also block Mara" });

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue({ reportId: "r1" });
});
afterEach(cleanup);

describe("ReportDialog", () => {
  it("quotes the reported message and groups the reasons under a legend", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Report Mara" })).toBeTruthy();
    expect(screen.getByText("Send me your address now")).toBeTruthy();
    const group = screen.getByRole("group", {
      name: "Why are you reporting this?",
    });
    expect(group.querySelectorAll("input[type=radio]")).toHaveLength(6);
  });

  it("says who is reported for a member target", () => {
    renderDialog({ kind: "user", id: MARA });
    expect(screen.getByText("Reporting Mara")).toBeTruthy();
  });

  it("keeps submit disabled until a reason is chosen", () => {
    renderDialog();
    expect(submitButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Spam or scam" }));
    expect(submitButton().hasAttribute("disabled")).toBe(false);
  });

  it("requires the good-faith statement for illegal content", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "Illegal content" }));
    expect(submitButton().hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText(/Your name and email from your account are included/),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I confirm in good faith that this information is accurate and complete.",
      }),
    );
    expect(submitButton().hasAttribute("disabled")).toBe(false);
  });

  it("pre-checks Also block for harassment and sexual content only", () => {
    renderDialog();
    const checked = () => alsoBlock().getAttribute("aria-checked");
    expect(checked()).toBe("false");
    fireEvent.click(screen.getByRole("radio", { name: "Harassment or hate" }));
    expect(checked()).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Spam or scam" }));
    expect(checked()).toBe("false");
    fireEvent.click(
      screen.getByRole("radio", { name: "Sexual or inappropriate content" }),
    );
    expect(checked()).toBe("true");
  });

  it("hides Also block when the member isn't known", () => {
    renderDialog({ kind: "photo", id: "img_1" }, null);
    expect(screen.queryByRole("checkbox", { name: /Also block/ })).toBeNull();
    expect(screen.getByText("Reporting a photo from Mara")).toBeTruthy();
  });

  it("files the report, then blocks, then shows the confirmation", async () => {
    const { onBlocked } = renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "Harassment or hate" }));
    fireEvent.change(screen.getByLabelText("Details (optional)"), {
      target: { value: "  Keeps messaging me  " },
    });
    fireEvent.click(submitButton());

    expect(
      await screen.findByText(/Mara won't know who reported them/),
    ).toBeTruthy();
    expect(mocks.mutation.mock.calls).toEqual([
      [
        FILE,
        {
          targetKind: "message",
          targetId: "msg_1",
          reason: "harassment_hate",
          details: "Keeps messaging me",
        },
      ],
      [BLOCK, { memberId: MARA }],
    ]);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(screen.getByText("You blocked Mara.")).toBeTruthy();
  });

  it("sends the good-faith notice and skips blocking when unchecked", async () => {
    renderDialog({ kind: "user", id: MARA });
    fireEvent.click(screen.getByRole("radio", { name: "Illegal content" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /good faith/ }));
    fireEvent.click(submitButton());
    await screen.findByText("Report sent");
    expect(mocks.mutation.mock.calls).toEqual([
      [
        FILE,
        {
          targetKind: "user",
          targetId: MARA,
          reason: "illegal",
          illegalNotice: { goodFaith: true },
        },
      ],
    ]);
  });

  it("maps RateLimited to its message and never blocks", async () => {
    mocks.mutation.mockRejectedValue(new ConvexError({ code: "RateLimited" }));
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "Harassment or hate" }));
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "You've sent a lot of reports today. Try again tomorrow.",
      ),
    );
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Report sent")).toBeNull();
  });
});

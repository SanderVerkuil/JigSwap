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
import en from "../../../../locales/en.json";
import { ReportDetail, type ReportDetailView } from "./report-detail";

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

const DECIDE = getFunctionName(gateway.admin.decideReport);
const NOW = new Date("2026-10-18T12:00:00Z");

const report = (overrides: Partial<ReportDetailView> = {}) =>
  ({
    reportId: "report_1",
    targetKind: "message",
    targetId: "msg_2",
    reason: "harassment_hate",
    evidence: {
      messages: [
        {
          messageId: "msg_1",
          authorId: "user_reporter",
          kind: "text",
          body: "Hi!",
          sentAt: 1,
        },
        {
          messageId: "msg_2",
          authorId: "user_reported",
          kind: "text",
          body: "Get lost",
          sentAt: 2,
        },
      ],
    },
    status: "open",
    decidedByLabel: null,
    createdAt: NOW.getTime() - 3_600_000,
    reporterId: "user_reporter",
    reporterLabel: "Rita (rita@example.com)",
    reportedUserId: "user_reported",
    reportedLabel: "Otto (otto@example.com)",
    targetSummary: "Get lost",
    photoUrl: null,
    otherReportCount: 0,
    otherReports: [],
    ...overrides,
  }) as unknown as ReportDetailView;

const renderDetail = (view: ReportDetailView) =>
  render(
    <IntlProvider
      locale="en"
      messages={en}
      timeZone="Europe/Amsterdam"
      now={NOW}
    >
      <ReportDetail report={view} />
    </IntlProvider>,
  );

const removeRadio = () => screen.getByRole("radio", { name: "Remove content" });
const statement = () =>
  screen.getByLabelText("Statement of reasons (sent to the member)");

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

describe("ReportDetail", () => {
  it("quotes the thread excerpt with the reported message highlighted", () => {
    renderDetail(report());
    const current = document.querySelector('li[aria-current="true"]');
    expect(current?.textContent).toContain("Get lost");
    expect(current?.textContent).toContain("Otto (otto@example.com)");
  });

  it("shows an evidence message removed by a moderator as removed, never its body", () => {
    renderDetail(
      report({
        evidence: {
          messages: [
            {
              messageId: "msg_1",
              authorId: "user_reported",
              kind: "text",
              body: "",
              sentAt: 1,
              removed: true,
            },
            {
              messageId: "msg_2",
              authorId: "user_reported",
              kind: "text",
              body: "Get lost",
              sentAt: 2,
            },
          ],
        },
      } as Partial<ReportDetailView>),
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]!.textContent).toContain(
      "This message was removed by a moderator.",
    );
    expect(items[1]!.textContent).toContain("Get lost");
  });

  it("names the notifier without a separator when the notice has no email", () => {
    renderDetail(
      report({
        reason: "illegal",
        illegalNotice: { notifierName: "Rita R.", goodFaith: true },
      } as Partial<ReportDetailView>),
    );
    expect(screen.getByText("Rita R.").textContent).toBe("Rita R.");
  });

  it("names the notifier and their email when present", () => {
    renderDetail(
      report({
        reason: "illegal",
        illegalNotice: {
          notifierName: "Rita R.",
          notifierEmail: "rita@example.org",
          goodFaith: true,
        },
      } as Partial<ReportDetailView>),
    );
    expect(screen.getByText("Rita R. · rita@example.org")).toBeTruthy();
  });

  it("disables Remove for a user target", () => {
    renderDetail(report({ targetKind: "user", targetId: "user_reported" }));
    expect((removeRadio() as HTMLInputElement).disabled).toBe(true);
    expect(
      (screen.getByRole("radio", { name: "Warn member" }) as HTMLInputElement)
        .disabled,
    ).toBe(false);
  });

  it("requires a statement of reasons", () => {
    renderDetail(report());
    fireEvent.click(screen.getByRole("radio", { name: "Warn member" }));
    const submit = screen.getByRole("button", { name: "Warn member" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(statement(), { target: { value: "   " } });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(statement(), { target: { value: "Rude language." } });
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("decides with the chosen decision and trimmed statement", async () => {
    renderDetail(report());
    fireEvent.click(screen.getByRole("radio", { name: "Warn member" }));
    fireEvent.change(statement(), { target: { value: "  Rude language.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Warn member" }));
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(DECIDE, {
        reportId: "report_1",
        decision: "warned",
        statementOfReasons: "Rude language.",
      }),
    );
  });

  it("inserts a template and confirms before removing content", async () => {
    renderDetail(report());
    fireEvent.click(removeRadio());
    fireEvent.click(screen.getByRole("button", { name: "Removal template" }));
    expect((statement() as HTMLTextAreaElement).value).toBe(
      "We removed your message because it breaks our community guidelines on harassment and hate. If you think we got this wrong, you can ask for a review via the contact page.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove content" }));
    expect(mocks.mutation).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("alertdialog", {
      name: "Remove this content?",
    });
    fireEvent.click(
      [...confirm.querySelectorAll("button")].find(
        (button) => button.textContent === "Remove content",
      )!,
    );
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(
        DECIDE,
        expect.objectContaining({ decision: "content_removed" }),
      ),
    );
  });

  it("shows the outcome instead of the form once decided", () => {
    renderDetail(
      report({
        status: "dismissed",
        decision: "dismissed",
        statementOfReasons: "No breach found.",
        decidedByLabel: "Ada",
      }),
    );
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("No breach found.")).toBeTruthy();
    expect(screen.getByText("Decided by Ada")).toBeTruthy();
  });
});

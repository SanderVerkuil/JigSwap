// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
const statementValue = () => (statement() as HTMLTextAreaElement).value;

// The templates as rendered for the default report (a message, harassment_hate).
const REMOVAL =
  "We removed your message because it breaks our community guidelines on harassment and hate. If you think we got this wrong, you can ask for a review via the contact page.";
const WARNING =
  "We're warning you about your message: it breaks our community guidelines on harassment and hate. Nothing was removed this time. If you think we got this wrong, you can ask for a review via the contact page.";
const NO_VIOLATION =
  "We reviewed a report about your message and found no breach of our community guidelines on harassment and hate. Nothing was restricted. You can ask for a review via the contact page.";

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
    // The evidence quotes private messages: the drawer stays out of PostHog capture.
    expect(current?.closest(".ph-no-capture")).not.toBeNull();
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

  it.each([
    ["photoComment", "Photo comment", "your comment"],
    ["puzzleReview", "Puzzle review", "your review text"],
  ] as const)(
    "shows a reported %s's text as filed and lets an admin remove it",
    (targetKind, kindLabel, content) => {
      renderDetail(
        report({
          targetKind,
          targetId: "target_1",
          evidence: { text: "You are an idiot" },
          targetSummary: "You are an idiot",
        } as Partial<ReportDetailView>),
      );
      expect(screen.getByText(kindLabel)).toBeTruthy();
      const evidence = screen.getByRole("region", {
        name: "Reported text at filing time",
      });
      expect(evidence.textContent).toContain("You are an idiot");
      expect(evidence.textContent).toContain("Otto (otto@example.com)");
      expect((removeRadio() as HTMLInputElement).disabled).toBe(false);
      fireEvent.click(removeRadio());
      fireEvent.click(screen.getByRole("button", { name: "Removal template" }));
      expect((statement() as HTMLTextAreaElement).value).toMatch(
        new RegExp(`^We removed ${content} because`),
      );
    },
  );

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
    const submit = screen.getByRole("button", { name: "Choose a decision" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Warn member" }));
    fireEvent.change(statement(), { target: { value: "" } });
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

  it("fills in the chosen decision's template while the text is untouched", () => {
    renderDetail(report());
    expect(statementValue()).toBe("");
    // No decision yet: no template to insert.
    expect(
      screen.queryByRole("button", { name: "Insert template" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Warn member" }));
    expect(statementValue()).toBe(WARNING);
    fireEvent.click(screen.getByRole("radio", { name: "Dismiss" }));
    expect(statementValue()).toBe(NO_VIOLATION);
    fireEvent.click(removeRadio());
    expect(statementValue()).toBe(REMOVAL);
    // The text is the decision's template already.
    expect(
      screen.queryByRole("button", { name: "Insert template" }),
    ).toBeNull();
  });

  it("keeps the admin's own text when the decision changes, and asks before replacing it", async () => {
    renderDetail(report());
    fireEvent.change(statement(), { target: { value: "My own words." } });
    fireEvent.click(screen.getByRole("radio", { name: "Warn member" }));
    expect(statementValue()).toBe("My own words.");

    fireEvent.click(screen.getByRole("button", { name: "Insert template" }));
    let confirm = await screen.findByRole("alertdialog", {
      name: "Replace your text?",
    });
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(statementValue()).toBe("My own words.");

    fireEvent.click(screen.getByRole("button", { name: "Insert template" }));
    confirm = await screen.findByRole("alertdialog", {
      name: "Replace your text?",
    });
    expect(confirm.textContent).toContain("Warn member");
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Replace text" }),
    );
    await waitFor(() => expect(statementValue()).toBe(WARNING));
    // Focus lands back in the text, not on the Insert template button that is now gone.
    await waitFor(() => expect(document.activeElement).toBe(statement()));
  });

  it("inserts the template straight away over empty or template text", () => {
    renderDetail(report());
    fireEvent.click(screen.getByRole("radio", { name: "Warn member" }));
    fireEvent.change(statement(), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Insert template" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(statementValue()).toBe(WARNING);
  });

  it("confirms before removing content, with the removal template filled in", async () => {
    renderDetail(report());
    fireEvent.click(removeRadio());
    expect(statementValue()).toBe(REMOVAL);
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

  it("shows a reported photo blurred until the admin reveals it", () => {
    renderDetail(
      report({
        targetKind: "photo",
        targetId: "photo_1",
        photoUrl: "https://example.test/photo.jpg",
        evidence: {},
      } as Partial<ReportDetailView>),
    );
    const reveal = screen.getByRole("button", {
      name: "Click or tap to reveal the photo",
    });
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.test/photo.jpg",
    );
    fireEvent.click(reveal);
    expect(screen.getByRole("button", { name: "Hide again" })).toBeTruthy();
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

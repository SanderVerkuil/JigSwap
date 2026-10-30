// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { SubmissionDetail, type PendingSubmission } from "./submission-detail";

// The duplicate check is the only query: each test sets what the approved-only suggestions
// search returns for the submission's title.
let suggestions: { _id: string; title: string }[] = [];
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: suggestions }),
}));

// Router-free Link: the test asserts the rendered href, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children?: ReactNode;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      )}
      {...rest}
    >
      {children}
    </a>
  ),
}));

beforeEach(() => {
  suggestions = [];
});
afterEach(cleanup);

const submission = {
  _id: "p1",
  aggregateId: "agg-1",
  title: "Starry Night",
  pieceCount: 1000,
  createdAt: 0,
} as unknown as PendingSubmission;

const renderDetail = (onReject = vi.fn()) =>
  render(
    <IntlProvider
      locale="en"
      messages={en}
      timeZone="Europe/Amsterdam"
      now={new Date(0)}
    >
      <SubmissionDetail
        submission={submission}
        busy={false}
        onApprove={vi.fn()}
        onEditApprove={vi.fn()}
        onReject={onReject}
      />
    </IntlProvider>,
  );

describe("SubmissionDetail reject", () => {
  it("opens the reject dialog without a duplicate when the check found none", () => {
    const onReject = vi.fn();
    renderDetail(onReject);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onReject).toHaveBeenCalledWith(undefined);
  });

  it("hands the matched duplicate's title to the reject dialog", () => {
    suggestions = [{ _id: "dup1", title: "Starry Night (1000pc)" }];
    const onReject = vi.fn();
    renderDetail(onReject);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onReject).toHaveBeenCalledWith("Starry Night (1000pc)");
  });
});

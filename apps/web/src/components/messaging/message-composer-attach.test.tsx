// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { MessageComposer } from "./message-composer";

// A copy's "Message" that lands in an existing DM brings the puzzle along: the thread route hands
// the composer the copy id, and the composer stages the card the server resolved.

const POST = getFunctionName(gateway.conversation.postMessage);

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const fn = (args: unknown) => mocks.mutation(getFunctionName(ref), args);
    return Object.assign(fn, { withOptimisticUpdate: () => fn });
  },
}));

vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "me" }, isMemberLoading: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const CARD = {
  copyId: "copy_1",
  title: "Harbour Lights",
  brand: "Ravensburger",
  pieceCount: 1000,
  coverUrl: null,
};

const Composer = ({
  threadId,
  attachCopyId,
}: {
  threadId: string;
  attachCopyId?: string;
}) => (
  <MessageComposer
    threadId={threadId}
    attachCopyId={attachCopyId}
    recipientName="Mara"
    theirsLabel={null}
  />
);

const setup = (
  view: unknown,
  props: { threadId?: string; attachCopyId?: string } = {},
) => {
  const client = new QueryClient();
  client.setQueryData(
    convexQuery(gateway.conversation.getCopyConversation, {
      copyId: "copy_1" as never,
    }).queryKey,
    view,
  );
  const tree = (threadId: string, attachCopyId?: string) => (
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Composer threadId={threadId} attachCopyId={attachCopyId} />
      </IntlProvider>
    </QueryClientProvider>
  );
  const threadId = props.threadId ?? "thread_1";
  const attachCopyId = props.attachCopyId ?? "copy_1";
  const view_ = render(tree(threadId, attachCopyId));
  return {
    rerender: (next: string, nextAttach?: string) =>
      view_.rerender(tree(next, nextAttach)),
  };
};

const EXISTING = { status: "existing", threadId: "thread_1", copy: CARD };
const removeChip = () =>
  screen.queryByRole("button", { name: "Remove Harbour Lights" });

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue("message_1");
});
afterEach(cleanup);

describe("MessageComposer: a puzzle brought along by a copy's Message", () => {
  it("stages the puzzle and sends it with the text", async () => {
    setup(EXISTING);
    expect(removeChip()).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "still available?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(
        POST,
        expect.objectContaining({
          threadId: "thread_1",
          body: "still available?",
          copyId: "copy_1",
        }),
      ),
    );
    await waitFor(() => expect(removeChip()).toBeNull());
  });

  it("can be removed, and stays removed when the composer re-renders", () => {
    const { rerender } = setup(EXISTING);
    fireEvent.click(removeChip() as HTMLElement);
    expect(removeChip()).toBeNull();
    rerender("thread_1", "copy_1");
    expect(removeChip()).toBeNull();
  });

  it("stays staged after the param leaves the URL", () => {
    const { rerender } = setup(EXISTING);
    rerender("thread_1", undefined);
    expect(removeChip()).toBeTruthy();
  });

  it("stays with its own conversation when the member opens another thread", () => {
    const { rerender } = setup(EXISTING);
    rerender("thread_2", "copy_1");
    expect(removeChip()).toBeNull();
    rerender("thread_1", "copy_1");
    expect(removeChip()).toBeTruthy();
  });

  it("ignores a copy that belongs to another conversation", () => {
    setup({ ...EXISTING, threadId: "thread_other" });
    expect(removeChip()).toBeNull();
  });

  it("ignores a copy the server no longer offers", () => {
    setup({ status: "unavailable" });
    expect(removeChip()).toBeNull();
  });
});

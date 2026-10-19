// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { MessageComposer } from "./message-composer";
import { resetPhotosAvailability } from "./use-photo-staging";

const UPLOAD_URL = getFunctionName(
  gateway.conversation.generateMessageUploadUrl,
);
const STAGE = getFunctionName(gateway.conversation.stageMessageImage);
const SEND = getFunctionName(gateway.conversation.sendStagedImages);

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  prepare: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const fn = (args: unknown) => mocks.mutation(getFunctionName(ref), args);
    return Object.assign(fn, { withOptimisticUpdate: () => fn });
  },
}));

vi.mock("./prepare-photo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./prepare-photo")>()),
  preparePhoto: mocks.prepare,
  uploadWithProgress: mocks.upload,
}));

vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "me" }, isMemberLoading: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const jpeg = (name = "photo.jpg") =>
  new File(["x"], name, { type: "image/jpeg" });

let attachmentCounter = 0;

const renderComposer = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <MessageComposer
          threadId="thread_1"
          recipientName="Mara"
          theirsLabel={null}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );

const fileInput = () =>
  document.querySelector<HTMLInputElement>("input[type='file']")!;

const pick = (files: File[]) =>
  act(async () => {
    fireEvent.change(fileInput(), { target: { files } });
  });

const openMenu = async () => {
  fireEvent.keyDown(screen.getByRole("button", { name: "Attach" }), {
    key: "Enter",
  });
  await screen.findAllByRole("menuitem");
  return screen.getAllByRole("menuitem").map((item) => item.textContent);
};

const sendButton = () =>
  screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement;

beforeEach(() => {
  resetPhotosAvailability();
  attachmentCounter = 0;
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  mocks.prepare.mockReset().mockImplementation(async () => ({
    file: new Blob(["jpeg"], { type: "image/jpeg" }),
    width: 1600,
    height: 1200,
  }));
  mocks.upload
    .mockReset()
    .mockImplementation(
      async (_url: string, _blob: Blob, onProgress: (n: number) => void) => {
        onProgress(1);
        return "storage_1";
      },
    );
  mocks.mutation.mockReset().mockImplementation(async (name) => {
    if (name === UPLOAD_URL) return "https://upload.test";
    if (name === STAGE) return { attachmentId: `att${++attachmentCounter}` };
    return null;
  });
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
});
afterEach(cleanup);

describe("MessageComposer attach menu", () => {
  it("sits between the text field and Send: textarea, attach, send", () => {
    renderComposer();
    const textarea = screen.getByRole("textbox", { name: "Message Mara" });
    const attach = screen.getByRole("button", { name: "Attach" });
    const send = sendButton();
    // DOM order is the tab order and matches the visual order.
    expect(
      textarea.compareDocumentPosition(attach) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      attach.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // A paperclip, not a "+".
    expect(attach.querySelector("svg.lucide-paperclip")).not.toBeNull();
    expect(attach.querySelector("svg.lucide-plus")).toBeNull();
  });

  it("is a menu with Puzzle and Photo, and a hidden multi-file input", async () => {
    renderComposer();
    const trigger = screen.getByRole("button", { name: "Attach" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(await openMenu()).toEqual(["Attach a puzzle", "Photo"]);
    expect(fileInput().multiple).toBe(true);
    expect(fileInput().accept).toBe(
      "image/jpeg,image/png,image/heic,image/webp",
    );
  });

  it("Photo opens the file picker", async () => {
    renderComposer();
    const click = vi.spyOn(fileInput(), "click").mockImplementation(() => {});
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Photo" }));
    expect(click).toHaveBeenCalled();
  });
});

describe("MessageComposer photo staging", () => {
  it("shows upload progress, then ready, and stages with the converted size", async () => {
    let finish: (id: string) => void = () => {};
    mocks.upload.mockImplementation(
      (_url: string, _blob: Blob, onProgress: (n: number) => void) => {
        onProgress(0.5);
        return new Promise<string>((resolve) => (finish = resolve));
      },
    );
    renderComposer();
    await pick([jpeg()]);
    const ring = await screen.findByTestId("progress-ring");
    expect(ring.getAttribute("data-progress")).toBe("50");
    expect(sendButton().disabled).toBe(true);
    await act(async () => finish("storage_9"));
    expect(await screen.findByText("Ready")).toBeTruthy();
    expect(mocks.mutation).toHaveBeenCalledWith(STAGE, {
      threadId: "thread_1",
      storageId: "storage_9",
      width: 1600,
      height: 1200,
    });
  });

  it("maps a refusal to its message and lets the chip be removed", async () => {
    mocks.mutation.mockImplementation(async (name) =>
      name === UPLOAD_URL
        ? "https://upload.test"
        : name === STAGE
          ? { refused: "ImageTooLarge" }
          : null,
    );
    renderComposer();
    await pick([jpeg()]);
    expect(await screen.findByText("This photo is too large.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Photo 1" }));
    expect(screen.queryByText("This photo is too large.")).toBeNull();
  });

  it("refuses a file the browser can't convert", async () => {
    mocks.prepare.mockRejectedValue(new Error("decode failed"));
    renderComposer();
    await pick([new File(["x"], "photo.heic", { type: "image/heic" })]);
    expect(
      await screen.findByText("This photo can't be read. Try a JPEG or PNG."),
    ).toBeTruthy();
    expect(mocks.mutation).not.toHaveBeenCalledWith(
      UPLOAD_URL,
      expect.anything(),
    );
  });

  it("stages at most four photos per send", async () => {
    renderComposer();
    await pick([jpeg("1"), jpeg("2"), jpeg("3"), jpeg("4"), jpeg("5")]);
    await waitFor(() => expect(screen.getAllByText("Ready")).toHaveLength(4));
    expect(toast.info).toHaveBeenCalledWith(
      "You can send up to 4 photos at a time.",
    );
    await pick([jpeg("6")]);
    expect(screen.getAllByText("Ready")).toHaveLength(4);
  });

  it("ImagesUnavailable drops the photo, says so once and hides Photo", async () => {
    mocks.mutation.mockImplementation(async (name) => {
      if (name === UPLOAD_URL) {
        throw new ConvexError({ code: "ImagesUnavailable" });
      }
      return null;
    });
    renderComposer();
    await pick([jpeg()]);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Photos can't be sent right now.",
      ),
    );
    expect(screen.queryByRole("list", { name: "Photos to send" })).toBeNull();
    expect(await openMenu()).toEqual(["Attach a puzzle"]);
  });
});

describe("MessageComposer send", () => {
  it("is enabled by text or a ready photo, and sends photos with the text as caption", async () => {
    renderComposer();
    expect(sendButton().disabled).toBe(true);
    await pick([jpeg("1"), jpeg("2")]);
    await waitFor(() => expect(screen.getAllByText("Ready")).toHaveLength(2));
    expect(sendButton().disabled).toBe(false);
    const textarea = screen.getByRole("textbox", { name: "Message Mara" });
    fireEvent.change(textarea, { target: { value: "  Our holiday  " } });
    fireEvent.click(sendButton());
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(SEND, {
        threadId: "thread_1",
        attachmentIds: ["att1", "att2"],
        caption: "Our holiday",
      }),
    );
    expect((textarea as HTMLTextAreaElement).value).toBe("");
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Photos to send" })).toBeNull(),
    );
    expect(mocks.mutation).not.toHaveBeenCalledWith(
      getFunctionName(gateway.conversation.postMessage),
      expect.anything(),
    );
  });

  it("sends photos without a caption when there is no text", async () => {
    renderComposer();
    await pick([jpeg()]);
    await screen.findByText("Ready");
    fireEvent.click(sendButton());
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(SEND, {
        threadId: "thread_1",
        attachmentIds: ["att1"],
      }),
    );
  });

  it("drops the photos when they can no longer be sent (AttachmentNotFound)", async () => {
    mocks.mutation.mockImplementation(async (name) => {
      if (name === UPLOAD_URL) return "https://upload.test";
      if (name === STAGE) return { attachmentId: "att1" };
      if (name === SEND) throw new ConvexError({ code: "AttachmentNotFound" });
      return null;
    });
    renderComposer();
    await pick([jpeg()]);
    await screen.findByText("Ready");
    fireEvent.click(sendButton());
    expect(
      await screen.findByText(
        "These photos can't be sent any more. Add them again to retry.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Photos to send" })).toBeNull();
  });

  it("gives the caption and the photos back when the send fails", async () => {
    mocks.mutation.mockImplementation(async (name) => {
      if (name === UPLOAD_URL) return "https://upload.test";
      if (name === STAGE) return { attachmentId: "att1" };
      if (name === SEND) throw new Error("offline");
      return null;
    });
    renderComposer();
    await pick([jpeg()]);
    await screen.findByText("Ready");
    const textarea = screen.getByRole("textbox", { name: "Message Mara" });
    fireEvent.change(textarea, { target: { value: "Hi" } });
    fireEvent.click(sendButton());
    expect(
      await screen.findByText(
        "Your message couldn't be sent. Please try again.",
      ),
    ).toBeTruthy();
    expect((textarea as HTMLTextAreaElement).value).toBe("Hi");
    expect(screen.getByText("Ready")).toBeTruthy();
  });
});

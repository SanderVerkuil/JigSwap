// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { MessageActions } from "./message-actions";
import { MessagePhotos, type PhotoMessage } from "./message-photos";
import { PhotoOutbox } from "./photo-outbox";

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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const wrap = (node: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        {node}
      </IntlProvider>
    </QueryClientProvider>,
  );

const photo = (
  id: string,
  attachment: PhotoMessage["attachment"],
  body = "",
): PhotoMessage => ({
  id,
  kind: "image",
  body,
  attachmentId: `att-${id}`,
  attachment,
});

const READY = {
  status: "ready" as const,
  url: "https://files.test/full.jpg",
  thumbUrl: "https://files.test/thumb.jpg",
  w: 1600,
  h: 1200,
};

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

describe("MessagePhotos", () => {
  it("ready: a button named for the sender and caption, with the aspect ratio reserved", () => {
    wrap(
      <MessagePhotos
        messages={[photo("m1", READY, "Look at this sky")]}
        own={false}
        authorName="Mara"
      />,
    );
    const button = screen.getByRole("button", {
      name: "Photo from Mara: Look at this sky",
    });
    expect(button.getAttribute("style")).toContain("aspect-ratio");
    const img = button.querySelector("img[loading='lazy']");
    expect(img?.getAttribute("src")).toBe(READY.url);
  });

  it("opens the lightbox with Report photo, which reports the attachment", async () => {
    wrap(
      <MessagePhotos
        messages={[photo("m1", READY)]}
        own={false}
        authorName="Mara"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Photo from Mara" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Photo from Mara",
    });
    expect(dialog).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Report photo" }));
    expect(await screen.findByText("Reporting a photo from Mara")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Spam or scam" }));
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(
        "reports/fileReport:fileReport",
        expect.objectContaining({
          targetKind: "attachment",
          targetId: "att-m1",
        }),
      ),
    );
  });

  it("closing the lightbox with Esc returns focus to the tile", async () => {
    wrap(
      <MessagePhotos
        messages={[photo("m1", READY), photo("m2", READY)]}
        own={false}
        authorName="Mara"
      />,
    );
    const tile = screen.getByRole("button", { name: "Photo 2 of 2, open" });
    tile.focus();
    fireEvent.click(tile);
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(tile));
  });

  it("own photos open without a Report action", async () => {
    wrap(
      <MessagePhotos messages={[photo("m1", READY)]} own authorName="You" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Your photo" }));
    await screen.findByRole("dialog", { name: "Your photo" });
    expect(screen.queryByRole("button", { name: "Report photo" })).toBeNull();
  });

  it("blurred: no photo and no revealing alt; Show calls revealMessageImage, then shows it", async () => {
    mocks.mutation.mockImplementation(async (name) =>
      name === "conversation/revealMessageImage:revealMessageImage"
        ? { url: "https://files.test/revealed.jpg" }
        : null,
    );
    const { container } = wrap(
      <MessagePhotos
        messages={[photo("m1", { status: "blurred", w: 800, h: 600 })]}
        own={false}
        authorName="Mara"
      />,
    );
    expect(container.querySelector("img[alt]:not([alt=''])")).toBeNull();
    expect(screen.queryByRole("button", { name: /Photo from/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Report photo" })).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Sensitive content · Show" }),
    );
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(
        "conversation/revealMessageImage:revealMessageImage",
        { attachmentId: "att-m1" },
      ),
    );
    const opened = await screen.findByRole("button", {
      name: "Photo from Mara",
    });
    expect(opened.querySelector("img[loading]")?.getAttribute("src")).toBe(
      "https://files.test/revealed.jpg",
    );
  });

  it("blurred: a refused reveal (AttachmentNotFound) keeps it blurred, without an error", async () => {
    mocks.mutation.mockRejectedValue(
      new ConvexError({ code: "AttachmentNotFound" }),
    );
    vi.mocked(toast.error).mockClear();
    wrap(
      <MessagePhotos
        messages={[photo("m1", { status: "blurred" })]}
        own={false}
        authorName="Mara"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Sensitive content · Show" }),
    );
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Sensitive content · Show",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Photo from/ })).toBeNull();
  });

  it("blurred and not checked says so", () => {
    wrap(
      <MessagePhotos
        messages={[photo("m1", { status: "blurred", notChecked: true })]}
        own={false}
        authorName="Mara"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Not checked · Show" }),
    ).toBeTruthy();
  });

  it("blurred tile's Report reports the attachment", async () => {
    wrap(
      <MessagePhotos
        messages={[photo("m1", { status: "blurred" })]}
        own={false}
        authorName="Mara"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Report photo" }));
    expect(await screen.findByText("Reporting a photo from Mara")).toBeTruthy();
  });

  it("removed: a placeholder with the same geometry and no actions", () => {
    const { container } = wrap(
      <MessagePhotos
        messages={[
          photo("m1", { status: "removed", w: 1000, h: 1000 }),
          { id: "m2", kind: "image", body: "", removed: true },
        ]}
        own={false}
        authorName="Mara"
      />,
    );
    expect(screen.getAllByText("Photo removed")).toHaveLength(2);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelector("img")).toBeNull();
  });

  it("groups photos into a grid: tiles named 'Photo n of 3, open', the first spanning the row", () => {
    wrap(
      <MessagePhotos
        messages={[photo("m1", READY), photo("m2", READY), photo("m3", READY)]}
        own={false}
        authorName="Mara"
      />,
    );
    const first = screen.getByRole("button", { name: "Photo 1 of 3, open" });
    expect(first.className).toContain("col-span-2");
    expect(
      screen.getByRole("button", { name: "Photo 3 of 3, open" }).className,
    ).not.toContain("col-span-2");
    // Grid cells use the thumbnail.
    expect(first.querySelector("img[loading]")?.getAttribute("src")).toBe(
      READY.thumbUrl,
    );
    expect(first.parentElement?.className).toContain("grid-cols-2");
  });

  it("the lightbox pages through the gallery", async () => {
    wrap(
      <MessagePhotos
        messages={[photo("m1", READY), photo("m2", READY)]}
        own={false}
        authorName="Mara"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Photo 2 of 2, open" }));
    expect(await screen.findByText("2 / 2", { selector: "span" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(await screen.findByText("1 / 2", { selector: "span" })).toBeTruthy();
  });
});

describe("MessageActions on photo messages", () => {
  const openMenu = async () => {
    fireEvent.keyDown(
      screen.getByRole("button", {
        name: "More actions for message from Mara",
      }),
      { key: "Enter" },
    );
    await screen.findAllByRole("menuitem");
    return screen.getAllByRole("menuitem").map((item) => item.textContent);
  };

  it("a captioned photo: Copy text and Report photo", async () => {
    wrap(
      <MessageActions
        messageId="m1"
        body="Look"
        authorName="Mara"
        attachmentId="att-m1"
      >
        <div />
      </MessageActions>,
    );
    expect(await openMenu()).toEqual(["Copy text", "Report photo"]);
  });

  it("a photo without caption: only Report photo, which reports the attachment", async () => {
    wrap(
      <MessageActions
        messageId="m1"
        body=""
        authorName="Mara"
        attachmentId="att-m1"
      >
        <div />
      </MessageActions>,
    );
    expect(await openMenu()).toEqual(["Report photo"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Report photo" }));
    expect(await screen.findByText("Reporting a photo from Mara")).toBeTruthy();
  });

  it("a text message keeps Copy text and Report message", async () => {
    wrap(
      <MessageActions messageId="m1" body="Hello" authorName="Mara">
        <div />
      </MessageActions>,
    );
    expect(await openMenu()).toEqual(["Copy text", "Report message"]);
  });
});

describe("PhotoOutbox", () => {
  const base = {
    attachmentId: "att1",
    sendRequested: true,
    createdAt: 0,
  };

  it("shows sent photos being checked, and nothing for staged-only ones", () => {
    wrap(
      <ul>
        <PhotoOutbox
          pending={[
            {
              ...base,
              status: "pending",
              thumbUrl: "https://files.test/t.jpg",
            },
            {
              ...base,
              attachmentId: "att2",
              status: "pending",
              sendRequested: false,
            },
          ]}
        />
      </ul>,
    );
    expect(screen.getAllByText("Checking photo…")).toHaveLength(1);
  });

  it("renders nothing when no photo was sent", () => {
    const { container } = wrap(
      <ul>
        <PhotoOutbox
          pending={[{ ...base, status: "pending", sendRequested: false }]}
        />
      </ul>,
    );
    expect(container.querySelector("li")).toBeNull();
  });

  it("flagged: the notice and Ask for a review, which calls requestImageReview", async () => {
    wrap(
      <ul>
        <PhotoOutbox
          pending={[{ ...base, status: "rejected", reason: "flagged" }]}
        />
      </ul>,
    );
    expect(
      screen.getByText(
        "This photo wasn't sent: our automated check flagged it.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask for a review" }));
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(
        "conversation/requestImageReview:requestImageReview",
        { attachmentId: "att1" },
      ),
    );
  });

  it("a review request for a photo that is gone drops it from the outbox", async () => {
    mocks.mutation.mockRejectedValue(
      new ConvexError({ code: "AttachmentNotFound" }),
    );
    wrap(
      <ul>
        <PhotoOutbox
          pending={[{ ...base, status: "rejected", reason: "flagged" }]}
        />
      </ul>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask for a review" }));
    await waitFor(() =>
      expect(screen.queryByTestId("photo-outbox")).toBeNull(),
    );
  });

  it("review requested, then upheld", () => {
    const { rerender } = wrap(
      <ul>
        <PhotoOutbox
          pending={[
            {
              ...base,
              status: "rejected",
              reason: "flagged",
              review: "requested",
            },
          ]}
        />
      </ul>,
    );
    expect(screen.getByText("Review requested")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Ask for a review" }),
    ).toBeNull();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
          <ul>
            <PhotoOutbox
              pending={[
                {
                  ...base,
                  status: "rejected",
                  reason: "flagged",
                  review: "upheld",
                },
              ]}
            />
          </ul>
        </IntlProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Reviewed: the decision stands.")).toBeTruthy();
  });

  it("unreadable: says so, without a review", () => {
    wrap(
      <ul>
        <PhotoOutbox
          pending={[{ ...base, status: "rejected", reason: "unreadable" }]}
        />
      </ul>,
    );
    expect(
      screen.getByText("This photo wasn't sent: it couldn't be read."),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

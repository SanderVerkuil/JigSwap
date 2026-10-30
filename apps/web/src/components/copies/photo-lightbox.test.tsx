// @vitest-environment happy-dom
import { ConvexError } from "convex/values";
import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { PhotoLightbox } from "./photo-lightbox";

// What the stubbed data layer answers: the photo's comments (the only query keyed by `photoId`, set
// per test) and the outcome of posting one.
const stub = vi.hoisted(() => ({
  photoComments: undefined as unknown[] | undefined,
  mutateAsync: (_args: unknown): Promise<unknown> => Promise.resolve(null),
}));

// The lightbox's comments/cover/remove features talk to Convex; stub the data layer so the tests
// cover the zoom surface and the comment composer without a backend.
vi.mock("@/gateway", () => ({
  gateway: new Proxy({}, { get: () => new Proxy({}, { get: () => ({}) }) }),
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (_fn: unknown, args: unknown) => ({ queryKey: ["stub"], args }),
  useConvexMutation: () => vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { args?: { photoId?: string } }) => ({
    data: options.args?.photoId ? stub.photoComments : undefined,
  }),
  useMutation: () => ({
    mutateAsync: (args: unknown) => stub.mutateAsync(args),
    isPending: false,
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof PhotoLightbox>;
type Photo = Props["gallery"][number];

const photo = (id: string): Photo =>
  ({
    id,
    url: `https://example.test/${id}.jpg`,
    createdAt: 1,
    uploader: { anonymous: false, member: { name: "Sam" } },
  }) as unknown as Photo;

const gallery = [photo("p1"), photo("p2")];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  stub.photoComments = undefined;
  stub.mutateAsync = () => Promise.resolve(null);
  vi.mocked(toast.error).mockClear();
});

const render = (props: Partial<Props> = {}, locale: "en" | "nl" = "en") =>
  act(() =>
    root.render(
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <PhotoLightbox
          gallery={gallery}
          index={0}
          open
          onOpenChange={() => {}}
          onIndexChange={() => {}}
          canSetCover={false}
          copyId="c1"
          coverImageId={null}
          {...props}
        />
      </IntlProvider>,
    ),
  );

const button = (label: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const transform = () =>
  document.querySelector<HTMLElement>('[data-testid="photo-zoom-content"]')!
    .style.transform;
const click = (el: HTMLElement) => act(() => el.click());

describe("PhotoLightbox zoom", () => {
  it("renders labelled zoom buttons, disabled at fit", () => {
    render();
    expect(button("Zoom in").disabled).toBe(false);
    expect(button("Zoom out").disabled).toBe(true);
    expect(button("Reset zoom").disabled).toBe(true);
    expect(transform()).toBe("translate(0px, 0px) scale(1)");
  });

  it("localises the zoom button labels", () => {
    render({}, "nl");
    expect(button("Inzoomen")).toBeTruthy();
    expect(button("Uitzoomen")).toBeTruthy();
    expect(button("Zoom herstellen")).toBeTruthy();
  });

  it("zooms in up to 4x, then disables zoom in", () => {
    render();
    click(button("Zoom in"));
    expect(transform()).toBe("translate(0px, 0px) scale(2)");
    expect(button("Zoom out").disabled).toBe(false);
    expect(button("Reset zoom").disabled).toBe(false);
    click(button("Zoom in"));
    click(button("Zoom in"));
    expect(transform()).toContain("scale(4)");
    expect(button("Zoom in").disabled).toBe(true);
    expect(document.querySelector('[aria-live="polite"]')!.textContent).toBe(
      "Zoom 400%",
    );
  });

  it("zooms back out and resets", () => {
    render();
    click(button("Zoom in"));
    click(button("Zoom in"));
    click(button("Zoom out"));
    expect(transform()).toContain("scale(2)");
    click(button("Reset zoom"));
    expect(transform()).toBe("translate(0px, 0px) scale(1)");
    expect(button("Zoom out").disabled).toBe(true);
  });

  it("resets the zoom when the photo changes", () => {
    render({ index: 0 });
    click(button("Zoom in"));
    expect(transform()).toContain("scale(2)");
    render({ index: 1 });
    expect(transform()).toBe("translate(0px, 0px) scale(1)");
    expect(button("Zoom out").disabled).toBe(true);
  });
});

describe("PhotoLightbox report", () => {
  const approved = gallery.map((p) => ({
    ...p,
    moderationStatus: "approved" as const,
  }));
  const reportButton = () =>
    [...document.querySelectorAll("button")].find(
      (el) => el.textContent === "Report photo",
    );

  it("offers Report photo on someone else's approved photo", () => {
    render({ gallery: approved });
    const trigger = reportButton();
    expect(trigger).toBeTruthy();
    click(trigger!);
    expect(document.body.textContent).toContain("Reporting a photo from Sam");
  });

  it("hides Report photo from the copy's manager", () => {
    render({ gallery: approved, canSetCover: true });
    expect(reportButton()).toBeUndefined();
  });
});

// SEC-38: the member who uploaded a photo may remove it without managing the copy (e.g. the
// previous owner after a transfer). Set cover stays with the copy's managers.
describe("PhotoLightbox remove", () => {
  const withRemove = (viewerMayRemove: boolean | undefined) =>
    gallery.map((p) => ({
      ...p,
      moderationStatus: "approved" as const,
      viewerMayRemove,
    })) as Photo[];
  const buttonWithText = (text: string) =>
    [...document.querySelectorAll("button")].find(
      (el) => el.textContent === text,
    );

  it("offers Remove, but neither Set cover nor Report, to the photo's uploader", () => {
    render({ gallery: withRemove(true), canSetCover: false });
    expect(buttonWithText("Remove photo")).toBeTruthy();
    expect(buttonWithText("Set as cover")).toBeUndefined();
    expect(buttonWithText("Report photo")).toBeUndefined();
  });

  it("hides Remove from a viewer who neither manages the copy nor uploaded the photo", () => {
    render({ gallery: withRemove(false), canSetCover: false });
    expect(buttonWithText("Remove photo")).toBeUndefined();
    expect(buttonWithText("Report photo")).toBeTruthy();
  });

  it("keeps Remove and Set cover for the copy's manager, also before the view reports viewerMayRemove", () => {
    render({ gallery: withRemove(undefined), canSetCover: true });
    expect(buttonWithText("Remove photo")).toBeTruthy();
    expect(buttonWithText("Set as cover")).toBeTruthy();
    expect(buttonWithText("Report photo")).toBeUndefined();
  });
});

// SEC-11: comment authors arrive privacy-projected. A hidden author shows the anonymous label and
// a person icon (no avatar, no initial); a departed one "Deleted member".
describe("PhotoLightbox comments", () => {
  // Only a published photo has a discussion.
  const approved = gallery.map((p) => ({
    ...p,
    moderationStatus: "approved" as const,
  }));
  type Comment = {
    id: string;
    author: unknown;
    text: string;
    createdAt: number;
  };
  const comment = (id: string, author: unknown): Comment => ({
    id,
    author,
    text: `text ${id}`,
    createdAt: 1,
  });
  const rows = () =>
    [...document.querySelectorAll("p")]
      .filter((el) => el.textContent?.startsWith("text "))
      .map((el) => el.parentElement!.parentElement!);

  it("names a revealed author, with their initial", () => {
    stub.photoComments = [
      comment("c1", {
        anonymous: false,
        member: { name: "Mara Jansen", avatar: "https://example.test/m.png" },
      }),
    ];
    render({ gallery: approved });
    const [row] = rows();
    expect(row.textContent).toContain("Mara Jansen");
    // The avatar fallback is the initial, not the anonymous person icon.
    expect(row.querySelector("svg")).toBeNull();
  });

  it("labels a hidden author 'Anonymous user' with the person icon", () => {
    stub.photoComments = [comment("c1", { anonymous: true, anonRef: "abc" })];
    render({ gallery: approved });
    const [row] = rows();
    expect(row.textContent).toContain("Anonymous user");
    expect(row.querySelector("svg")).not.toBeNull();
  });

  it("labels a departed author 'Deleted member', in Dutch too", () => {
    stub.photoComments = [
      comment("c1", { anonymous: true, anonRef: "abc", departed: true }),
    ];
    render({ gallery: approved });
    expect(rows()[0].textContent).toContain("Deleted member");
    render({ gallery: approved }, "nl");
    expect(rows()[0].textContent).toContain("Verwijderd lid");
  });

  it("uses the Dutch anonymous label", () => {
    stub.photoComments = [comment("c1", { anonymous: true, anonRef: "abc" })];
    render({ gallery: approved }, "nl");
    expect(rows()[0].textContent).toContain("Anonieme gebruiker");
  });

  // Deploy skew: the web ships before Convex, and a pre-SEC-11 backend still sends the author as a
  // plain MemberView. The row keeps the name that backend sent rather than the generic label.
  it("names a legacy MemberView author while the backend lags", () => {
    stub.photoComments = [
      comment("c1", { _id: "u1", name: "Mara Jansen", isActive: true }),
    ];
    render({ gallery: approved });
    const [row] = rows();
    expect(row.textContent).toContain("Mara Jansen");
    expect(row.querySelector("svg")).toBeNull();
  });

  it("labels a departed legacy author 'Deleted member'", () => {
    stub.photoComments = [comment("c1", { _id: "u1", isActive: false })];
    render({ gallery: approved });
    expect(rows()[0].textContent).toContain("Deleted member");
  });
});

describe("PhotoLightbox comment composer", () => {
  const approved = gallery.map((p) => ({
    ...p,
    moderationStatus: "approved" as const,
  }));
  const composer = () =>
    document.querySelector<HTMLInputElement>(
      'input[placeholder="Add a comment…"]',
    );
  const postButton = () =>
    [...document.querySelectorAll("button")].find(
      (el) => el.textContent === "Post",
    )!;
  const type = (input: HTMLInputElement, value: string) =>
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const post = async () => {
    await act(async () => {
      postButton().click();
      await Promise.resolve();
    });
  };

  it("limits the composer to the server's 1000 characters", () => {
    render({ gallery: approved });
    expect(composer()!.maxLength).toBe(1000);
  });

  it("explains a comment the server refuses as too long", async () => {
    stub.mutateAsync = () =>
      Promise.reject(
        new ConvexError({ code: "CommentTextTooLong", message: "too long" }),
      );
    render({ gallery: approved });
    type(composer()!, "Nice");
    await post();
    expect(toast.error).toHaveBeenCalledWith(
      "That comment is too long (1,000 characters max).",
    );
  });

  it("offers no composer on a photo still being checked, and says why", () => {
    render({
      gallery: gallery.map((p) => ({
        ...p,
        moderationStatus: "pending" as const,
      })),
    });
    expect(composer()).toBeNull();
    expect(document.body.textContent).toContain(
      "Comments open once this photo has been checked.",
    );
  });

  it("shows 100+ when the server's newest-100 list is full", () => {
    const comment = (i: number) => ({
      id: `c${i}`,
      author: { _id: "u1", isActive: true, name: "Sam" },
      text: `comment ${i}`,
      createdAt: 1,
    });
    stub.photoComments = Array.from({ length: 100 }, (_, i) => comment(i));
    render({ gallery: approved });
    const count = () =>
      [...document.querySelectorAll("span.font-mono")].map(
        (el) => el.textContent,
      );
    expect(count()).toContain("100+");

    stub.photoComments = Array.from({ length: 99 }, (_, i) => comment(i));
    render({ gallery: approved, index: 1 });
    expect(count()).toContain("99");
  });

  it("explains the comment rate limit", async () => {
    stub.mutateAsync = () =>
      Promise.reject(
        new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 }),
      );
    render({ gallery: approved });
    type(composer()!, "Nice");
    await post();
    expect(toast.error).toHaveBeenCalledWith(
      "You've posted a lot of comments lately. Try again later.",
    );
  });

  it("keeps the generic message for other failures", async () => {
    stub.mutateAsync = () => Promise.reject(new Error("offline"));
    render({ gallery: approved });
    type(composer()!, "Nice");
    await post();
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn’t post your comment. Please try again.",
    );
  });
});

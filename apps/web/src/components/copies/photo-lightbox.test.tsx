// @vitest-environment happy-dom
import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { PhotoLightbox } from "./photo-lightbox";

// The lightbox's comments/cover/remove features talk to Convex; stub the data layer so the test
// covers only the zoom surface.
vi.mock("@/gateway", () => ({
  gateway: new Proxy({}, { get: () => new Proxy({}, { get: () => ({}) }) }),
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: () => ({ queryKey: ["stub"] }),
  useConvexMutation: () => vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

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
    uploaderName: "Sam",
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

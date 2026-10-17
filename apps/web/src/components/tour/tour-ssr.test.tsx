import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { useTourLauncher } from "../whats-new/tour-launcher";
import { stepMessageKeys, TOURS } from "./definitions";
import { TourCardBody } from "./tour-layer";
import { TourProvider } from "./tour-provider";

// SSR safety: the provider and every step card render on the server without touching window or
// document (vitest runs in node, where neither exists). The real router and Convex client are not
// needed for that, so their hooks are stubbed.
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ state: { location: { pathname: "/whats-new" } } }),
  useNavigate: () => () => Promise.resolve(),
}));
vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation: () => () => Promise.resolve(null),
}));
vi.mock("@/components/whats-new/use-whats-new-state", () => ({
  useWhatsNewState: () => ({ unreadIds: undefined, tours: undefined }),
}));
vi.mock("@/gateway", () => ({
  gateway: { whatsNew: { recordTourProgress: "recordTourProgress" } },
}));

type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];
const isElement = (node: Node): node is Element => "tagName" in node;

const elements = (html: string): Element[] => {
  const out: Element[] = [];
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      out.push(node);
      walk(node.childNodes);
    }
  };
  walk(parseFragment(html).childNodes);
  return out;
};
const attr = (el: Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value;
const text = (el: Element | Node): string =>
  "value" in el
    ? el.value
    : "childNodes" in el
      ? el.childNodes.map(text).join("")
      : "";

const render = (node: ReactNode, locale: "en" | "nl" = "en") =>
  renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
      onError={(error) => {
        throw error; // a missing key must fail the test, not render the key
      }}
    >
      {node}
    </IntlProvider>,
  );

function Probe() {
  const { startTour } = useTourLauncher();
  return (
    <button type="button" onClick={() => startTour("households")}>
      probe
    </button>
  );
}

const noop = () => {};
const card = (over: Partial<Parameters<typeof TourCardBody>[0]> = {}) => (
  <TourCardBody
    ids={{ eyebrow: "e", title: "t", body: "b" }}
    stepLabel="Step 1 of 3"
    title="Title"
    body="Body"
    index={0}
    total={3}
    nextLabel="Next"
    isLast={false}
    touch={false}
    onBack={noop}
    onNext={noop}
    onClose={noop}
    {...over}
  />
);

describe("TourProvider on the server", () => {
  it("renders its children and no overlay, without window", () => {
    expect(typeof window).toBe("undefined");
    const html = render(
      <TourProvider>
        <Probe />
      </TourProvider>,
    );
    const els = elements(html);
    expect(els.map((el) => el.tagName)).toEqual(["button"]);
    expect(els.some((el) => attr(el, "data-tour-overlay") !== undefined)).toBe(
      false,
    );
  });
});

describe("TourCardBody", () => {
  it("renders every defined step in en and nl", () => {
    for (const locale of ["en", "nl"] as const) {
      const messages = locale === "en" ? en : nl;
      for (const tour of TOURS.values()) {
        tour.steps.forEach((step, index) => {
          const keys = stepMessageKeys(tour.id, step.id);
          const get = (key: string) =>
            key
              .split(".")
              .reduce<unknown>(
                (n, k) => (n as Record<string, unknown>)[k],
                messages,
              ) as string;
          const els = elements(
            render(
              card({
                title: get(keys.title),
                body: get(keys.body),
                index,
                total: tour.steps.length,
              }),
              locale,
            ),
          );
          const title = els.find((el) => el.tagName === "h2")!;
          expect(text(title)).toBe(get(keys.title));
          expect(text(els.find((el) => attr(el, "id") === "b")!)).toBe(
            get(keys.body),
          );
        });
      }
    }
  });

  it("labels the eyebrow, title and body for the dialog's aria references", () => {
    const els = elements(render(card()));
    expect(text(els.find((el) => attr(el, "id") === "e")!)).toBe("Step 1 of 3");
    const title = els.find((el) => attr(el, "id") === "t")!;
    expect(title.tagName).toBe("h2");
    expect(attr(title, "tabindex")).toBe("-1");
    expect(
      els.find((el) => attr(el, "aria-label") === "End tour")?.tagName,
    ).toBe("button");
  });

  it("hides Back on the first step and shows it later", () => {
    const buttons = (html: string) =>
      elements(html)
        .filter((el) => el.tagName === "button")
        .map((el) => text(el).trim() || attr(el, "aria-label"));
    expect(buttons(render(card()))).toEqual(["End tour", "Next"]);
    expect(buttons(render(card({ index: 1 })))).toEqual([
      "End tour",
      "Back",
      "Next",
    ]);
  });

  it("marks the current progress segment and hides the dots from assistive tech", () => {
    const els = elements(render(card({ index: 1 })));
    const progress = els.find(
      (el) => attr(el, "aria-hidden") === "true" && el.childNodes.length === 3,
    )!;
    const segments = progress.childNodes.filter(isElement);
    expect(segments.map((el) => attr(el, "class")?.includes("w-4"))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("replaces the body with the pending line while a page opens", () => {
    const els = elements(render(card({ pendingLabel: "Opening Household…" })));
    const body = els.find((el) => attr(el, "id") === "b")!;
    expect(text(body)).toBe("Opening Household…");
    expect(
      elements(render(card({ pendingLabel: "x" }))).some((el) =>
        attr(el, "class")?.includes("motion-reduce:animate-none"),
      ),
    ).toBe(true);
  });

  it("uses 44px touch targets on mobile", () => {
    const els = elements(render(card({ index: 1, touch: true })));
    const buttons = els.filter((el) => el.tagName === "button");
    expect(attr(buttons[0], "class")).toContain("size-11");
    expect(attr(buttons[1], "class")).toContain("min-h-11");
    expect(attr(buttons[2], "class")).toContain("min-h-11");
  });
});

// @vitest-environment happy-dom
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render as renderDom,
  screen,
  waitFor,
} from "@testing-library/react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { useRef, useState, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import { LeaveCircleAction } from "./leave-circle-action";

const useSignedOut = () => ({
  isLoading: false,
  isAuthenticated: false,
  fetchAccessToken: async () => null,
});

const Providers = ({
  locale = "en",
  children,
}: {
  locale?: "en" | "nl";
  children: ReactNode;
}) => {
  const convex = new ConvexReactClient("https://example.convex.cloud");
  const convexQueryClient = new ConvexQueryClient(convex);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { queryKeyHashFn: convexQueryClient.hashFn() } },
  });
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useSignedOut}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider
          locale={locale}
          messages={locale === "en" ? en : nl}
          timeZone="Europe/Amsterdam"
        >
          {children}
        </IntlProvider>
      </QueryClientProvider>
    </ConvexProviderWithAuth>
  );
};

const render = (locale: "en" | "nl" = "en") =>
  renderToStaticMarkup(
    <Providers locale={locale}>
      <LeaveCircleAction circleId="circle-1" circleName="Family" />
    </Providers>,
  );

// A host that opens the confirm itself (as a ⋯ menu item does) and names
// where focus goes back to.
function MenuHost() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        More actions
      </button>
      <LeaveCircleAction
        circleId="circle-1"
        circleName="Family"
        open={open}
        onOpenChange={setOpen}
        returnFocusRef={triggerRef}
      />
    </>
  );
}

afterEach(cleanup);

// Assert on a real HTML tree (parse5), never on regex-extracted markup.
type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];

const isElement = (node: Node): node is Element => "tagName" in node;

const elementsOf = (html: string): Element[] => {
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

const textOf = (el: Element): string =>
  el.childNodes
    .map((n) =>
      "value" in n && n.nodeName === "#text"
        ? n.value
        : isElement(n)
          ? textOf(n)
          : "",
    )
    .join("");

const trigger = (html: string) => {
  const buttons = elementsOf(html).filter((el) => el.tagName === "button");
  expect(buttons).toHaveLength(1);
  return buttons[0];
};

describe("LeaveCircleAction", () => {
  it("renders a labelled, destructive trigger that opens the confirm (en)", () => {
    const button = trigger(render("en"));
    // The meaning is carried by text, not colour alone.
    expect(textOf(button)).toBe("Leave circle");
    expect(attr(button, "class")).toContain("text-destructive");
    expect(attr(button, "aria-haspopup")).toBe("dialog");
  });

  it("is translated (nl)", () => {
    expect(textOf(trigger(render("nl")))).toBe("Kring verlaten");
  });

  it("names the circle in the confirm title in every catalog", () => {
    const title = (messages: typeof en, locale: string) =>
      createTranslator({ locale, messages, namespace: "circles" })(
        "leaveConfirmTitle",
        { circle: "Family" },
      );
    expect(title(en, "en")).toBe("Leave Family?");
    expect(title(source, "en")).toBe("Leave Family?");
    expect(title(nl, "nl")).toBe("Family verlaten?");
    expect(nl.circles.leaveConfirmBody).toBe(
      "Je verliest de toegang tot deze kring en de puzzels die erin gedeeld zijn. Een beheerder kan je opnieuw uitnodigen.",
    );
    expect(en.circles.leaveConfirmBody).toBe(
      "You'll lose access to this circle and the puzzles shared in it. An admin can invite you again.",
    );
    expect(source.circles).toEqual(en.circles);
  });
});

describe("LeaveCircleAction opened by its host (no trigger)", () => {
  it("renders no trigger of its own, only the confirm when asked", async () => {
    renderDom(
      <Providers>
        <MenuHost />
      </Providers>,
    );
    expect(screen.queryByRole("button", { name: "Leave circle" })).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Leave Family?",
    });
    expect(dialog.textContent).toContain(en.circles.leaveConfirmBody);
    expect(screen.getByRole("button", { name: "Leave circle" })).toBeTruthy();
  });

  it("returns focus to the host's trigger when cancelled", async () => {
    renderDom(
      <Providers>
        <MenuHost />
      </Providers>,
    );
    const host = screen.getByRole("button", { name: "More actions" });
    fireEvent.click(host);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.activeElement).toBe(host);
  });
});

import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  canManageCircle,
  CircleDeleteSection,
  CircleInviteSection,
} from "./circle-admin-sections";

const useSignedOut = () => ({
  isLoading: false,
  isAuthenticated: false,
  fetchAccessToken: async () => null,
});

type Viewer = {
  viewerPermission: "ViewOnly" | "Exchange" | "Admin";
  isOwnedByViewer: boolean;
};

// The manage dialog's gated sections, in dialog order, for one viewer.
const render = (viewer: Viewer, locale: "en" | "nl") => {
  const convex = new ConvexReactClient("https://example.convex.cloud");
  const convexQueryClient = new ConvexQueryClient(convex);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  });
  return renderToStaticMarkup(
    <ConvexProviderWithAuth client={convex} useAuth={useSignedOut}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider
          locale={locale}
          messages={locale === "en" ? en : nl}
          timeZone="Europe/Amsterdam"
        >
          <CircleInviteSection
            circleId="circle-1"
            viewerPermission={viewer.viewerPermission}
          />
          <CircleDeleteSection
            circleId="circle-1"
            circleName="Saturday Puzzlers"
            isOwnedByViewer={viewer.isOwnedByViewer}
            onDeleted={() => {}}
          />
        </IntlProvider>
      </QueryClientProvider>
    </ConvexProviderWithAuth>,
  );
};

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

// What the viewer can see: the invite picker's search box and the Delete button.
const seen = (html: string, locale: "en" | "nl") => {
  const t = createTranslator({
    locale,
    messages: locale === "en" ? en : nl,
    namespace: "circles",
  });
  const els = elementsOf(html);
  return {
    invitePicker: els.some(
      (el) =>
        el.tagName === "input" &&
        attr(el, "aria-label") === t("invite.searchPlaceholder"),
    ),
    deleteButton: els.some(
      (el) => el.tagName === "button" && textOf(el) === t("delete"),
    ),
  };
};

const OWNER: Viewer = { viewerPermission: "Admin", isOwnedByViewer: true };
const ADMIN: Viewer = { viewerPermission: "Admin", isOwnedByViewer: false };
const EXCHANGE: Viewer = {
  viewerPermission: "Exchange",
  isOwnedByViewer: false,
};
const VIEW_ONLY: Viewer = {
  viewerPermission: "ViewOnly",
  isOwnedByViewer: false,
};

describe.each(["en", "nl"] as const)("circle admin sections (%s)", (locale) => {
  it("the owner sees the invite picker and Delete", () => {
    expect(seen(render(OWNER, locale), locale)).toEqual({
      invitePicker: true,
      deleteButton: true,
    });
  });

  it("a non-owner Admin sees the invite picker but not Delete", () => {
    expect(seen(render(ADMIN, locale), locale)).toEqual({
      invitePicker: true,
      deleteButton: false,
    });
  });

  it("an Exchange or ViewOnly member sees neither", () => {
    for (const viewer of [EXCHANGE, VIEW_ONLY]) {
      expect(seen(render(viewer, locale), locale)).toEqual({
        invitePicker: false,
        deleteButton: false,
      });
    }
  });
});

describe("canManageCircle", () => {
  it("opens the manage dialog for Admins only", () => {
    expect(canManageCircle("Admin")).toBe(true);
    expect(canManageCircle("Exchange")).toBe(false);
    expect(canManageCircle("ViewOnly")).toBe(false);
  });
});

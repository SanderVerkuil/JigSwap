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
  canShareInCircle,
  CircleDeleteSection,
  CircleInviteSection,
  memberRowControls,
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

describe("canShareInCircle", () => {
  it("lets Exchange and Admin share their own copies, not View only", () => {
    expect(canShareInCircle("Admin")).toBe(true);
    expect(canShareInCircle("Exchange")).toBe(true);
    expect(canShareInCircle("ViewOnly")).toBe(false);
  });
});

describe("memberRowControls", () => {
  const ME = "u-me";
  const owner = { memberId: "u-owner", isOwner: true };
  const other = { memberId: "u-other", isOwner: false };
  const self = { memberId: ME, isOwner: false };

  it("lets an Admin change and remove another non-owner member", () => {
    expect(memberRowControls("Admin", other, ME)).toEqual({
      canChangePermission: true,
      canRemove: true,
    });
  });

  it("never edits the owner's seat", () => {
    expect(memberRowControls("Admin", owner, ME)).toEqual({
      canChangePermission: false,
      canRemove: false,
    });
  });

  it("offers no remove on the viewer's own row (that is Leave)", () => {
    expect(memberRowControls("Admin", self, ME)).toEqual({
      canChangePermission: true,
      canRemove: false,
    });
  });

  it("offers no remove until the viewer's id is known", () => {
    expect(memberRowControls("Admin", other, undefined).canRemove).toBe(false);
  });

  it("drops every control once the viewer is no longer an Admin", () => {
    for (const level of ["Exchange", "ViewOnly"] as const) {
      expect(memberRowControls(level, other, ME)).toEqual({
        canChangePermission: false,
        canRemove: false,
      });
    }
  });
});

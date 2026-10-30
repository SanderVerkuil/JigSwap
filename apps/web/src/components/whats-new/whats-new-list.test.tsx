// @vitest-environment happy-dom
import type { WhatsNewEntry } from "@/whats-new/types";
import type { WhatsNewTourProgressView } from "@jigswap/contracts";
import {
  cleanup,
  fireEvent,
  render as renderDom,
  screen,
} from "@testing-library/react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { WhatsNewList } from "./whats-new-list";

// Router-free Link: the test asserts the list's DOM, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    hash,
    children,
    ...rest
  }: {
    to: string;
    hash?: string;
    children?: ReactNode;
  }) => (
    <a href={hash ? `${to}#${hash}` : to} {...rest}>
      {children}
    </a>
  ),
}));

const content = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  summary: `${title} summary`,
  html: `<p>${title} body</p>`,
  fallback: false,
  ...extra,
});

const entry = (
  id: string,
  iso: string,
  extra: Partial<WhatsNewEntry> = {},
): WhatsNewEntry => ({
  id,
  publishedAt: Date.parse(iso),
  category: "feature",
  highlight: false,
  notify: false,
  content: { en: content(`EN ${id}`), nl: content(`NL ${id}`) },
  ...extra,
});

const ENTRIES: WhatsNewEntry[] = [
  entry("households", "2026-10-14T00:00:00Z", {
    tour: "households", // a real tour (3 steps), for the resume label
    ctaTo: "/household",
    content: {
      en: content("EN households", { ctaLabel: "Open household" }),
      nl: content("NL households", { ctaLabel: "Huishouden openen" }),
    },
  }),
  entry("names", "2026-10-03T00:00:00Z", { category: "fix" }),
  entry("faster", "2026-09-20T00:00:00Z", {
    category: "improvement",
    ctaTo: "/library",
    content: {
      en: content("EN faster", { ctaLabel: "Open library" }),
      nl: content("NL faster", { ctaLabel: "Bibliotheek openen" }),
    },
  }),
];

type ListProps = {
  entries?: WhatsNewEntry[];
  unreadIds?: string[];
  tours?: WhatsNewTourProgressView[];
  deepLinkId?: string;
};

const list = (props: ListProps, locale: "en" | "nl" = "en") => (
  <IntlProvider
    locale={locale}
    messages={locale === "en" ? en : nl}
    timeZone="Europe/Amsterdam"
  >
    <WhatsNewList
      entries={props.entries ?? ENTRIES}
      unreadIds={props.unreadIds}
      tours={props.tours}
      deepLinkId={props.deepLinkId}
    />
  </IntlProvider>
);

const render = (props: ListProps, locale: "en" | "nl" = "en") =>
  renderToStaticMarkup(list(props, locale));

// Assert on a real HTML tree (parse5), never on regex-extracted markup.
type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];

const isElement = (node: Node): node is Element => "tagName" in node;

const elementsOf = (root: { childNodes: Node[] }): Element[] => {
  const out: Element[] = [];
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      out.push(node);
      walk(node.childNodes);
    }
  };
  walk(root.childNodes);
  return out;
};

const parse = (html: string) => elementsOf(parseFragment(html));

const attr = (el: Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value;

const classes = (el: Element) => (attr(el, "class") ?? "").split(/\s+/);

const textOf = (el: Element): string =>
  el.childNodes
    .map((child) =>
      isElement(child) ? textOf(child) : "value" in child ? child.value : "",
    )
    .join("");

const article = (els: Element[], id: string) => {
  const found = els.find(
    (el) => el.tagName === "article" && attr(el, "id") === `entry-${id}`,
  );
  if (!found) throw new Error(`no article for ${id}`);
  return found;
};

describe("WhatsNewList", () => {
  it("groups entries into month sections, newest first, labelled by their h2", () => {
    const els = parse(render({ unreadIds: [] }));
    const sections = els.filter((el) => el.tagName === "section");
    expect(sections).toHaveLength(2);
    const headings = sections.map((section) => {
      const id = attr(section, "aria-labelledby");
      const h2 = elementsOf(section).find(
        (el) => el.tagName === "h2" && attr(el, "id") === id,
      );
      return h2 && textOf(h2);
    });
    expect(headings).toEqual(["October 2026", "September 2026"]);

    const firstIds = elementsOf(sections[0]!)
      .filter((el) => el.tagName === "article")
      .map((el) => attr(el, "id"));
    expect(firstIds).toEqual(["entry-households", "entry-names"]);
    // Entries are an ordered list.
    const ol = elementsOf(sections[0]!).find((el) => el.tagName === "ol")!;
    expect(
      ol.childNodes.filter(isElement).every((li) => li.tagName === "li"),
    ).toBe(true);
  });

  it("formats month headings in the reader's locale", () => {
    const h2s = parse(render({ unreadIds: [] }, "nl")).filter(
      (el) => el.tagName === "h2",
    );
    expect(h2s.map(textOf)).toEqual(["oktober 2026", "september 2026"]);
  });

  it("labels each article with its h3 title and a machine-readable date", () => {
    const els = parse(render({ unreadIds: [] }));
    const card = article(els, "names");
    const titleId = attr(card, "aria-labelledby");
    const h3 = elementsOf(card).find((el) => el.tagName === "h3")!;
    expect(attr(h3, "id")).toBe(titleId);
    expect(textOf(h3)).toBe("EN names");
    const time = elementsOf(card).find((el) => el.tagName === "time")!;
    expect(attr(time, "datetime")).toBe("2026-10-03");
  });

  it("renders the category chips with their label and colours", () => {
    const els = parse(render({ unreadIds: [] }));
    const chipOf = (id: string) =>
      elementsOf(article(els, id)).find((el) =>
        classes(el).includes("rounded-full"),
      )!;
    expect(textOf(chipOf("households"))).toBe("Feature");
    expect(classes(chipOf("households"))).toContain("dark:text-violet-300");
    expect(textOf(chipOf("names"))).toBe("Fix");
    expect(classes(chipOf("names"))).toContain("text-amber-800");
    expect(textOf(chipOf("faster"))).toBe("Improvement");

    const nlEls = parse(render({ unreadIds: [] }, "nl"));
    const nlChip = elementsOf(article(nlEls, "names")).find((el) =>
      classes(el).includes("rounded-full"),
    )!;
    expect(textOf(nlChip)).toBe("Oplossing");
  });

  it("marks unread entries with a text pill, an sr-only title prefix and a tint", () => {
    const els = parse(render({ unreadIds: ["households"] }));
    const unread = article(els, "households");
    const h3 = elementsOf(unread).find((el) => el.tagName === "h3")!;
    expect(textOf(h3)).toBe("New: EN households");
    const prefix = elementsOf(h3).find((el) => classes(el).includes("sr-only"));
    expect(prefix && textOf(prefix)).toBe("New: ");
    expect(
      elementsOf(unread).some(
        (el) => el.tagName === "span" && textOf(el) === "New",
      ),
    ).toBe(true);
    const card = elementsOf(unread).find(
      (el) => attr(el, "data-slot") === "card",
    )!;
    expect(classes(card)).toContain("border-primary/30");

    const read = article(els, "names");
    expect(
      elementsOf(read).find((el) => el.tagName === "h3")!.childNodes,
    ).toHaveLength(1);
    expect(textOf(read)).not.toContain("New");
  });

  it("shows no pills while the read state is loading", () => {
    const els = parse(render({ unreadIds: undefined }));
    expect(els.filter((el) => el.tagName === "article")).toHaveLength(3);
    expect(els.some((el) => textOf(el).includes("New"))).toBe(false);
  });

  it("renders the Markdown body and the summary", () => {
    const card = article(parse(render({ unreadIds: [] })), "names");
    const texts = elementsOf(card)
      .filter((el) => el.tagName === "p")
      .map(textOf);
    expect(texts).toEqual(["EN names summary", "EN names body"]);
  });

  it("offers the tour first and the CTA as an in-app link", () => {
    const card = article(parse(render({ unreadIds: [] })), "households");
    const actions = elementsOf(card).filter(
      (el) => el.tagName === "button" || el.tagName === "a",
    );
    expect(actions.map((el) => [el.tagName, textOf(el)])).toEqual([
      ["button", "Take the tour"],
      ["a", "Open household"],
    ]);
    expect(attr(actions[1]!, "href")).toBe("/household");
  });

  it("offers Resume (with the saved step) and Start over for a paused tour, Replay after completing it", () => {
    const actionsFor = (
      tours: WhatsNewTourProgressView[],
      locale: "en" | "nl" = "en",
    ) =>
      elementsOf(
        article(parse(render({ unreadIds: [], tours }, locale)), "households"),
      )
        .filter((el) => el.tagName === "button")
        .map(textOf);
    const paused: WhatsNewTourProgressView = {
      tourId: "households",
      status: "in_progress",
      step: 1,
      updatedAt: 1,
    };
    expect(actionsFor([paused])).toEqual([
      "Resume tour (step 2 of 3)",
      "Start over",
    ]);
    expect(actionsFor([paused], "nl")).toEqual([
      "Rondleiding hervatten (stap 2 van 3)",
      "Opnieuw beginnen",
    ]);
    expect(
      actionsFor([{ tourId: "households", status: "completed", updatedAt: 1 }]),
    ).toEqual(["Replay the tour"]);
    // Progress for another tour does not change this entry's button.
    expect(actionsFor([{ ...paused, tourId: "other" }])).toEqual([
      "Take the tour",
    ]);
  });

  it("sizes the tour, Start over and CTA actions for touch (UX-167)", () => {
    const paused: WhatsNewTourProgressView = {
      tourId: "households",
      status: "in_progress",
      step: 1,
      updatedAt: 1,
    };
    const els = parse(render({ unreadIds: [], tours: [paused] }));
    const actions = [
      ...elementsOf(article(els, "households")),
      ...elementsOf(article(els, "faster")),
    ].filter((el) => el.tagName === "button" || el.tagName === "a");
    expect(actions.map(textOf)).toEqual([
      "Resume tour (step 2 of 3)",
      "Start over",
      "Open household",
      "Open library",
    ]);
    for (const action of actions) {
      expect(classes(action)).toContain("pointer-coarse:min-h-11");
    }
  });

  it("makes the CTA the primary action when there is no tour, and omits actions without either", () => {
    const els = parse(render({ unreadIds: [] }));
    const cta = elementsOf(article(els, "faster")).find(
      (el) => el.tagName === "a",
    )!;
    expect(attr(cta, "href")).toBe("/library");
    expect(classes(cta)).toContain("bg-jigsaw-primary");
    const plain = elementsOf(article(els, "names"));
    expect(
      plain.some((el) => el.tagName === "a" || el.tagName === "button"),
    ).toBe(false);
  });

  it("uses the reader's locale for the entry copy", () => {
    const card = article(parse(render({ unreadIds: [] }, "nl")), "households");
    expect(textOf(elementsOf(card).find((el) => el.tagName === "h3")!)).toBe(
      "NL households",
    );
    expect(
      elementsOf(card)
        .filter((el) => el.tagName === "button" || el.tagName === "a")
        .map(textOf),
    ).toEqual(["Doe de rondleiding", "Huishouden openen"]);
  });

  it("shows the empty state when there are no entries", () => {
    const els = parse(render({ entries: [], unreadIds: [] }));
    expect(els.some((el) => el.tagName === "section")).toBe(false);
    const h2 = els.find((el) => el.tagName === "h2")!;
    expect(textOf(h2)).toBe("No updates yet");
  });
});

// Thirteen read entries, one a day, newest first; every fourth is a fix, the rest improvements.
const MANY: WhatsNewEntry[] = Array.from({ length: 13 }, (_, i) =>
  entry(`e${i}`, new Date(Date.UTC(2026, 9, 30 - i)).toISOString(), {
    category: i % 4 === 3 ? "fix" : "improvement",
  }),
);

const articleIds = (els: Element[]) =>
  els
    .filter((el) => el.tagName === "article")
    .map((el) => attr(el, "id")!.replace(/^entry-/, ""));

describe("WhatsNewList is readable on a phone (UX-90)", () => {
  afterEach(cleanup);

  const detailsOf = (els: Element[], id: string) =>
    elementsOf(article(els, id)).find((el) => el.tagName === "details");

  it("keeps a read entry's image and body behind Read more, with the summary outside", () => {
    const withImage: WhatsNewEntry[] = [
      { ...ENTRIES[1]!, image: "/whats-new/names.png" },
    ];
    const els = parse(render({ entries: withImage, unreadIds: [] }));
    const details = detailsOf(els, "names")!;
    expect(attr(details, "open")).toBeUndefined();
    const summary = elementsOf(details).find((el) => el.tagName === "summary")!;
    expect(attr(summary, "aria-describedby")).toBe("entry-names-title");
    const labels = elementsOf(summary)
      .filter((el) => el.tagName === "span")
      .map(textOf);
    expect(labels).toEqual(["Read more", "Show less"]);
    // The image and body are inside the disclosure; the summary paragraph is not.
    expect(elementsOf(details).some((el) => el.tagName === "img")).toBe(true);
    expect(textOf(details)).toContain("EN names body");
    expect(textOf(details)).not.toContain("EN names summary");
    expect(textOf(article(els, "names"))).toContain("EN names summary");

    const nlSummary = elementsOf(
      detailsOf(
        parse(render({ entries: withImage, unreadIds: [] }, "nl")),
        "names",
      )!,
    ).find((el) => el.tagName === "summary")!;
    expect(
      elementsOf(nlSummary)
        .filter((el) => el.tagName === "span")
        .map(textOf),
    ).toEqual(["Lees meer", "Minder tonen"]);
  });

  it("opens the body of unread and deep-linked entries", () => {
    const els = parse(
      render({ unreadIds: ["households"], deepLinkId: "faster" }),
    );
    expect(attr(detailsOf(els, "households")!, "open")).toBe("");
    expect(attr(detailsOf(els, "faster")!, "open")).toBe("");
    expect(attr(detailsOf(els, "names")!, "open")).toBeUndefined();
  });

  it("has no disclosure for an entry without an image or body", () => {
    const bare = entry("bare", "2026-10-01T00:00:00Z", {
      content: {
        en: content("EN bare", { html: "" }),
        nl: content("NL bare", { html: "" }),
      },
    });
    const els = parse(render({ entries: [bare], unreadIds: [] }));
    expect(detailsOf(els, "bare")).toBeUndefined();
  });

  it("renders the newest ten and offers the rest behind Show N older updates", () => {
    const els = parse(render({ entries: MANY, unreadIds: [] }));
    expect(articleIds(els)).toEqual(MANY.slice(0, 10).map((e) => e.id));
    const more = els.filter(
      (el) => el.tagName === "button" && textOf(el).includes("older"),
    );
    expect(more.map(textOf)).toEqual(["Show 3 older updates"]);

    const nlEls = parse(render({ entries: MANY, unreadIds: [] }, "nl"));
    expect(
      nlEls
        .filter((el) => el.tagName === "button")
        .map(textOf)
        .filter((text) => text.includes("oudere")),
    ).toEqual(["3 oudere updates tonen"]);
  });

  it("always renders unread and deep-linked older entries", () => {
    const els = parse(
      render({ entries: MANY, unreadIds: ["e11"], deepLinkId: "e12" }),
    );
    expect(articleIds(els)).toEqual([
      ...MANY.slice(0, 10).map((e) => e.id),
      "e11",
      "e12",
    ]);
    expect(attr(detailsOf(els, "e12")!, "open")).toBe("");
    expect(
      els
        .filter((el) => el.tagName === "button" && textOf(el).includes("older"))
        .map(textOf),
    ).toEqual(["Show 1 older update"]);
    // Nothing older to show: no button.
    expect(
      parse(render({ unreadIds: [] })).some(
        (el) => el.tagName === "button" && textOf(el).includes("older"),
      ),
    ).toBe(false);
  });

  it("offers a filter for the categories in use, All pressed first", () => {
    const els = parse(render({ entries: MANY, unreadIds: [] }));
    const group = els.find((el) => attr(el, "role") === "group")!;
    expect(attr(group, "aria-label")).toBe("Filter updates by type");
    const chips = elementsOf(group).filter((el) => el.tagName === "button");
    expect(chips.map((el) => [textOf(el), attr(el, "aria-pressed")])).toEqual([
      ["All", "true"],
      ["Improvement", "false"],
      ["Fix", "false"],
    ]);
    // One category: nothing to filter.
    expect(
      parse(render({ entries: [ENTRIES[0]!], unreadIds: [] })).some(
        (el) => attr(el, "role") === "group",
      ),
    ).toBe(false);
  });

  it("filters by category and reveals older updates, moving focus to the first one shown", () => {
    renderDom(list({ entries: MANY, unreadIds: [] }));
    const shown = () =>
      Array.from(document.querySelectorAll("article")).map((el) =>
        el.id.replace(/^entry-/, ""),
      );

    fireEvent.click(screen.getByRole("button", { name: "Fix" }));
    expect(
      screen.getByRole("button", { name: "Fix" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(shown()).toEqual(["e3", "e7", "e11"]);
    expect(screen.queryByRole("button", { name: /older/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(shown()).toHaveLength(10);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 3 older updates" }),
    );
    expect(shown()).toEqual(MANY.map((e) => e.id));
    expect(document.activeElement?.id).toBe("entry-e10-title");
    expect(screen.queryByRole("button", { name: /older/ })).toBeNull();
  });
});

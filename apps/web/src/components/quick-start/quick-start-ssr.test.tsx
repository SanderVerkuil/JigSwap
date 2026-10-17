import { Dialog } from "@/components/ui/dialog";
import type { QuickStartStepView, QuickStartView } from "@jigswap/contracts";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { QuickStartDonePanel, QuickStartFlowView } from "./flow-view";
import { HouseholdChoiceView } from "./household-step";
import { PushPromptCard } from "./push-prompt";
import { QuickSetupCardView } from "./quick-setup-card";
import { WelcomeDialogBody } from "./welcome-dialog";

// Router-free Link: the tests assert the DOM, not routing. The search object is serialised the
// way the router would, so row hrefs are checkable.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string;
    search?: Record<string, string | undefined>;
    children?: ReactNode;
  }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search ?? {})) {
      if (value !== undefined) params.set(key, value);
    }
    const query = params.toString();
    return (
      <a href={query ? `${to}?${query}` : to} {...rest}>
        {children}
      </a>
    );
  },
}));

type Locale = "en" | "nl";
const render = (node: ReactNode, locale: Locale = "en") =>
  renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      {node}
    </IntlProvider>,
  );

// Assert on a real HTML tree (parse5), never on regex-extracted markup.
type Element = DefaultTreeAdapterMap["element"];
type Node = DefaultTreeAdapterMap["childNode"];
const elements = (root: { childNodes: Node[] }): Element[] =>
  root.childNodes.flatMap((node) =>
    "tagName" in node ? [node, ...elements(node)] : [],
  );
const all = (html: string) => elements(parseFragment(html));
const attr = (el: Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value;
const text = (node: { childNodes?: Node[] }): string =>
  (node.childNodes ?? [])
    .map((child) =>
      child.nodeName === "#text"
        ? (child as DefaultTreeAdapterMap["textNode"]).value
        : text(child as Element),
    )
    .join("");
// Text a screen reader reads: aria-hidden subtrees (markers, icons) are left out.
const nameOf = (node: { childNodes?: Node[] }): string =>
  (node.childNodes ?? [])
    .map((child) =>
      child.nodeName === "#text"
        ? (child as DefaultTreeAdapterMap["textNode"]).value
        : attr(child as Element, "aria-hidden") === "true"
          ? ""
          : nameOf(child as Element),
    )
    .join("");
const byTag = (html: string, tag: string) =>
  all(html).filter((el) => el.tagName === tag);
const controls = (html: string) =>
  all(html).filter((el) => el.tagName === "a" || el.tagName === "button");
const isInteractive = (el: Element) =>
  el.tagName === "a" || el.tagName === "button";

const step = (
  id: QuickStartStepView["id"],
  status: QuickStartStepView["status"] = "todo",
  extra: Partial<QuickStartStepView> = {},
): QuickStartStepView => ({
  id,
  status,
  optional: id === "household",
  ...extra,
});

const VIEW: QuickStartView = {
  eligible: true,
  showWelcome: false,
  cardVisible: true,
  steps: [
    step("puzzles", "done", { count: 7 }),
    step("solves", "done", { count: 3 }),
    step("people", "todo", { count: 0 }),
    step("household", "skipped", { pendingInvite: false }),
    step("profile"),
  ],
  requiredDone: 2,
  requiredTotal: 4,
};

describe("QuickSetupCardView (active)", () => {
  const html = render(
    <QuickSetupCardView view={VIEW} mode="active" onHide={() => {}} />,
  );

  it("is a section labelled by its h2, with the x of 4 meta", () => {
    const [section] = byTag(html, "section");
    const [h2] = byTag(html, "h2");
    expect(text(h2!)).toBe("Quick setup");
    expect(attr(section!, "aria-labelledby")).toBe(attr(h2!, "id"));
    expect(text(section!)).toContain("2 of 4");
  });

  it("has one progressbar with four decorative segments", () => {
    const bars = all(html).filter((el) => attr(el, "role") === "progressbar");
    expect(bars).toHaveLength(1);
    const bar = bars[0]!;
    expect(attr(bar, "aria-valuemin")).toBe("0");
    expect(attr(bar, "aria-valuemax")).toBe("4");
    expect(attr(bar, "aria-valuenow")).toBe("2");
    expect(attr(bar, "aria-valuetext")).toBe("2 of 4 steps done");
    expect(attr(bar, "aria-labelledby")).toBe(
      attr(byTag(html, "h2")[0]!, "id"),
    );
    const segments = elements(bar);
    expect(segments).toHaveLength(4);
    expect(segments.every((s) => attr(s, "aria-hidden") === "true")).toBe(true);
    expect(
      segments.map((s) => attr(s, "class")?.includes("bg-primary")),
    ).toEqual([true, true, false, false]);
  });

  it("lists the five steps as an ordered list of links to /welcome", () => {
    const [ol] = byTag(html, "ol");
    const rows = elements(ol!).filter((el) => el.tagName === "li");
    expect(rows).toHaveLength(5);
    const links = rows.map((li) =>
      elements(li).find((el) => el.tagName === "a")!,
    );
    expect(links.map((a) => attr(a, "href"))).toEqual([
      "/welcome?step=puzzles",
      "/welcome?step=solves",
      "/welcome?step=people",
      "/welcome?step=household",
      "/welcome?step=profile",
    ]);
  });

  it("names each row with its label, a state word and the sub-line", () => {
    const links = byTag(html, "a");
    expect(nameOf(links[0]!)).toBe("Add your puzzles, done, 7 added");
    expect(nameOf(links[2]!)).toBe("Find your people, to do");
    expect(nameOf(links[3]!)).toBe(
      "HouseholdOptional, skipped, Skipped · Do it now",
    );
  });

  it("never nests an interactive element inside a row link", () => {
    for (const link of byTag(html, "a")) {
      expect(elements(link).some(isInteractive)).toBe(false);
    }
  });

  it("has a named hide button", () => {
    const hide = byTag(html, "button");
    expect(hide.map((b) => attr(b, "aria-label"))).toEqual([
      "Hide quick setup",
    ]);
  });

  it("uses the green pill for done and never the secondary tint", () => {
    expect(html).not.toContain("bg-jigsaw-secondary-tint");
    const pills = all(html).filter((el) =>
      attr(el, "class")?.includes("bg-green-100"),
    );
    expect(pills).toHaveLength(2);
  });

  it("shows an in-progress puzzles row and a waiting household invite", () => {
    const partial = render(
      <QuickSetupCardView
        view={{
          ...VIEW,
          steps: [
            step("puzzles", "todo", { count: 2 }),
            step("solves"),
            step("people"),
            step("household", "todo", { pendingInvite: true }),
            step("profile"),
          ],
        }}
        mode="active"
        onHide={() => {}}
      />,
    );
    const links = byTag(partial, "a");
    expect(nameOf(links[0]!)).toBe(
      "Add your puzzles, in progress, Continue · 2 of 3",
    );
    expect(nameOf(links[3]!)).toBe(
      "HouseholdOptional, to do, Invitation waiting",
    );
  });

  it("renders in Dutch", () => {
    const nlHtml = render(
      <QuickSetupCardView view={VIEW} mode="active" onHide={() => {}} />,
      "nl",
    );
    expect(text(byTag(nlHtml, "h2")[0]!)).toBe("Snel instellen");
    expect(nameOf(byTag(nlHtml, "a")[0]!)).toBe(
      "Voeg je puzzels toe, klaar, 7 toegevoegd",
    );
    expect(nameOf(byTag(nlHtml, "a")[1]!)).toBe(
      "Leg vast wat je al hebt afgemaakt, klaar, 3 vastgelegd",
    );
    expect(text(parseFragment(nlHtml))).toContain("2 van 4");
    expect(attr(byTag(nlHtml, "button")[0]!, "aria-label")).toBe(
      "Snel instellen verbergen",
    );
  });
});

describe("QuickSetupCardView (all done)", () => {
  it("shrinks to one row with no heading or progress bar", () => {
    const html = render(
      <QuickSetupCardView view={VIEW} mode="allDone" onHide={() => {}} />,
    );
    expect(byTag(html, "h2")).toHaveLength(0);
    expect(all(html).some((el) => attr(el, "role") === "progressbar")).toBe(
      false,
    );
    expect(text(parseFragment(html))).toContain("Your shelf is set up");
    const [hide] = byTag(html, "button");
    expect(text(hide!)).toBe("Hide");
    expect(attr(hide!, "aria-label")).toBe("Hide quick setup");
  });
});

describe("WelcomeDialogBody", () => {
  const renderDialog = (locale: Locale) =>
    render(
      <Dialog open>
        <WelcomeDialogBody onClose={() => {}} />
      </Dialog>,
      locale,
    );

  it("has the title, the three numbered lines and the time line", () => {
    const html = renderDialog("en");
    expect(text(byTag(html, "h2")[0]!)).toBe("Welcome to JigSwap!");
    const [ol] = byTag(html, "ol");
    expect(attr(ol!, "role")).toBe("list");
    const items = elements(ol!).filter((el) => el.tagName === "li");
    expect(items.map((li) => text(li))).toEqual([
      "1Add the puzzles on your shelf",
      "2Mark the ones you've finished",
      "3Find the people you puzzle with",
    ]);
    expect(text(parseFragment(html))).toContain(
      "Takes about 3 minutes. You can stop at any time.",
    );
  });

  it("puts the ghost first and the primary (focus target) last, linking to /welcome", () => {
    const html = renderDialog("en");
    const actions = controls(html);
    expect(actions.map((el) => text(el))).toEqual([
      "Explore on my own",
      "Start quick setup",
    ]);
    const primary = actions[1]!;
    expect(attr(primary, "href")).toBe("/welcome");
    expect(attr(primary, "data-quickstart-primary")).toBeDefined();
    expect(attr(primary, "class")).toContain("bg-jigsaw-primary");
    expect(attr(primary, "class")).toContain("text-white");
  });

  it("renders in Dutch with afgemaakt", () => {
    const html = renderDialog("nl");
    expect(text(byTag(html, "h2")[0]!)).toBe("Welkom bij JigSwap!");
    expect(controls(html).map((el) => text(el))).toEqual([
      "Zelf rondkijken",
      "Snel instellen",
    ]);
    expect(text(parseFragment(html))).toContain(
      "Vink aan welke je al hebt afgemaakt",
    );
  });
});

describe("QuickStartFlowView", () => {
  const renderFlow = (id: QuickStartStepView["id"], locale: Locale = "en") =>
    render(
      <QuickStartFlowView
        step={id}
        view={VIEW}
        onSkip={() => {}}
        onContinue={() => {}}
      >
        <p>body</p>
      </QuickStartFlowView>,
      locale,
    );

  it("titles the step with a focusable h2 and an eyebrow", () => {
    const html = renderFlow("solves");
    const [h2] = byTag(html, "h2");
    expect(text(h2!)).toBe("Log puzzles you finished");
    expect(attr(h2!, "tabindex")).toBe("-1");
    expect(text(parseFragment(html))).toContain(
      "Step 2 of 4 · Log puzzles you finished",
    );
  });

  it("marks household as the optional step", () => {
    expect(text(parseFragment(renderFlow("household")))).toContain(
      "Optional step · Household",
    );
  });

  it("marks the current step in the desktop stepper", () => {
    const html = renderFlow("people");
    const current = all(html).filter(
      (el) => attr(el, "aria-current") === "step",
    );
    expect(current.map((el) => text(el))).toEqual(["3Find your people"]);
  });

  it("ends with Skip then Continue, after the body, in DOM order", () => {
    const html = renderFlow("puzzles");
    const labels = controls(html).map((el) => text(el));
    expect(labels.slice(-2)).toEqual(["Skip", "Continue"]);
    expect(labels).toContain("Finish later");
    const flat = text(parseFragment(html));
    expect(flat.indexOf("body")).toBeLessThan(flat.lastIndexOf("Skip"));
  });

  it("docks the footer above the mobile tab bar", () => {
    const html = renderFlow("puzzles");
    const footer = all(html).find((el) =>
      attr(el, "class")?.includes("sticky bottom-14"),
    );
    expect(footer).toBeDefined();
    expect(attr(footer!, "class")).toContain("md:bottom-0");
  });

  it("renders in Dutch", () => {
    const html = renderFlow("people", "nl");
    expect(text(byTag(html, "h2")[0]!)).toBe("Vind je puzzelmaatjes");
    expect(
      controls(html)
        .map((el) => text(el))
        .slice(-2),
    ).toEqual(["Overslaan", "Doorgaan"]);
    expect(text(parseFragment(html))).toContain("Stap 3 van 4");
  });
});

describe("QuickStartDonePanel", () => {
  it("announces the summary and links to the shelf", () => {
    const html = render(<QuickStartDonePanel view={VIEW} />);
    expect(text(byTag(html, "h2")[0]!)).toBe("Your shelf is ready");
    const status = all(html).find((el) => attr(el, "role") === "status");
    expect(text(status!)).toBe("7 puzzles · 3 finished · 0 following");
    const links = byTag(html, "a");
    expect(links.map((a) => [text(a), attr(a, "href")])).toEqual([
      ["Go to my shelf", "/dashboard"],
    ]);
  });

  it("only animates under motion-safe", () => {
    const html = render(<QuickStartDonePanel view={VIEW} />);
    for (const el of all(html)) {
      const cls = attr(el, "class") ?? "";
      for (const token of cls.split(/\s+/)) {
        if (/animate-|zoom-in|fade-in/.test(token)) {
          expect(token.startsWith("motion-safe:")).toBe(true);
        }
      }
    }
  });

  it("renders in Dutch", () => {
    const html = render(<QuickStartDonePanel view={VIEW} />, "nl");
    const status = all(html).find((el) => attr(el, "role") === "status");
    expect(text(status!)).toBe("7 puzzels · 3 afgemaakt · 0 gevolgd");
    expect(text(byTag(html, "a")[0]!)).toBe("Naar mijn plank");
  });
});

describe("HouseholdChoiceView", () => {
  const noop = () => {};

  it("offers create or puzzle alone without an invite", () => {
    const html = render(
      <HouseholdChoiceView
        invites={[]}
        busy={false}
        onAccept={noop}
        onDecline={noop}
        onCreate={noop}
        onAlone={noop}
      />,
    );
    expect(controls(html).map((el) => text(el))).toEqual([
      "Create a household",
      "I puzzle alone",
    ]);
  });

  it("puts a pending invite first, with Accept and Decline", () => {
    const html = render(
      <HouseholdChoiceView
        invites={[
          {
            inviteId: "i1",
            inviter: { memberId: "m1", name: "Anna" },
          } as never,
        ]}
        busy={false}
        onAccept={noop}
        onDecline={noop}
        onCreate={noop}
        onAlone={noop}
      />,
      "nl",
    );
    expect(text(parseFragment(html))).toContain(
      "Anna heeft je uitgenodigd voor hun huishouden",
    );
    expect(controls(html).map((el) => text(el))).toEqual([
      "Accepteren",
      "Weigeren",
    ]);
  });
});

describe("PushPromptCard", () => {
  it("offers Turn on (primary look) and Not now", () => {
    const html = render(
      <PushPromptCard busy={false} onEnable={() => {}} onNotNow={() => {}} />,
    );
    const buttons = byTag(html, "button");
    expect(buttons.map((b) => text(b))).toEqual([
      "Turn on notifications",
      "Not now",
    ]);
    expect(attr(buttons[0]!, "class")).toContain("bg-jigsaw-primary");
    expect(all(html).some((el) => attr(el, "role") === "dialog")).toBe(false);
  });
});

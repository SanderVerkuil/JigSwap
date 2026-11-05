// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import { LegalDoc, type LegalSection } from "./legal-doc";

afterEach(cleanup);

describe("LegalDoc", () => {
  it("renders a section's action inside that section, after its text", () => {
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <LegalDoc
          updated="Last updated: today"
          intro="Intro"
          sections={[
            {
              id: "p-cookies",
              heading: "Cookies",
              blocks: [{ type: "p", text: "How we use cookies." }],
              action: <button type="button">Change cookie settings</button>,
            },
            {
              id: "p-children",
              heading: "Children",
              blocks: [{ type: "p", text: "Not for children." }],
            },
          ]}
        />
      </IntlProvider>,
    );

    const cookies = document.getElementById("p-cookies");
    expect(cookies).toBeTruthy();
    const action = within(cookies as HTMLElement).getByRole("button", {
      name: "Change cookie settings",
    });
    const text = within(cookies as HTMLElement).getByText(
      "How we use cookies.",
    );
    expect(
      text.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Change cookie settings" }),
    ).toHaveLength(1);
  });
});

const sections: LegalSection[] = [
  { id: "p-who", heading: "Who we are", blocks: [{ type: "p", text: "Us." }] },
  {
    id: "p-cookies",
    heading: "Cookies",
    blocks: [{ type: "p", text: "Crumbs." }],
  },
];

const renderDoc = () =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <LegalDoc updated="Updated today" intro="Intro." sections={sections} />
    </IntlProvider>,
  );

const hrefs = (root: HTMLElement) =>
  within(root)
    .getAllByRole("link")
    .map((a) => a.getAttribute("href"));

describe("LegalDoc contents", () => {
  it("links every section by its hash, so a section can be shared and opened directly", () => {
    renderDoc();
    const [sideNav] = screen.getAllByRole("navigation", { name: "Contents" });
    expect(hrefs(sideNav)).toEqual(["#p-who", "#p-cookies"]);
    expect(within(sideNav).queryByRole("button")).toBeNull();
  });

  it("marks the section being read as the current one", () => {
    renderDoc();
    const [sideNav] = screen.getAllByRole("navigation", { name: "Contents" });
    const links = within(sideNav).getAllByRole("link");
    expect(links[0].getAttribute("aria-current")).toBe("true");
    expect(links[1].hasAttribute("aria-current")).toBe(false);
  });

  it("offers the same list as a collapsible Contents block for narrow screens", () => {
    const { container } = renderDoc();
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.querySelector("summary")?.textContent).toBe("Contents");
    expect(hrefs(details as HTMLElement)).toEqual(["#p-who", "#p-cookies"]);
  });
});

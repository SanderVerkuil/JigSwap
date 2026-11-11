// @vitest-environment happy-dom
import { Label } from "@/components/ui/label";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { CATALOG_TEXT_LIMITS, MAX_CATALOG_TAGS } from "./catalog-text-limits";
import { TagInput } from "./tag-input";

// A controlled host, like the catalogue forms; exposes the current tags for assertions.
function Host({
  id,
  initial = [],
  locale = "en",
}: {
  id?: string;
  initial?: string[];
  locale?: "en" | "nl";
}) {
  const [tags, setTags] = useState<string[]>(initial);
  return (
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      {id && <Label htmlFor={id}>Keywords</Label>}
      <TagInput id={id} value={tags} onChange={setTags} />
      <output data-testid="tags">{JSON.stringify(tags)}</output>
    </IntlProvider>
  );
}

const fullList = () =>
  Array.from({ length: MAX_CATALOG_TAGS }, (_, i) => `t${i}`);

const tagsShown = () =>
  JSON.parse(screen.getByTestId("tags").textContent ?? "[]") as string[];

const type = (text: string) => {
  const input = screen.getByLabelText("Tags");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
};

const fill = (input: HTMLElement, value: string) =>
  fireEvent.change(input, { target: { value } });

afterEach(cleanup);

describe("TagInput", () => {
  it("is named by the visible label it is tied to", () => {
    render(<Host id="tags" />);
    expect(screen.getByRole("textbox", { name: "Keywords" })).toBeTruthy();
  });

  it("falls back to its own name without a label", () => {
    render(<Host />);
    expect(screen.getByRole("textbox", { name: "Tags" })).toBeTruthy();
  });

  it("adds a tag on Enter, splitting comma-separated text", () => {
    render(<Host id="tags" />);
    const input = screen.getByRole("textbox", { name: "Keywords" });

    fill(input, "ocean");
    fireEvent.keyDown(input, { key: "Enter" });
    fill(input, "calm, forest ,ocean");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(tagsShown()).toEqual(["ocean", "calm", "forest"]);
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("adds what is typed when the field loses focus", () => {
    render(<Host id="tags" />);
    const input = screen.getByRole("textbox", { name: "Keywords" });
    fill(input, "sunset");
    fireEvent.blur(input);
    expect(tagsShown()).toEqual(["sunset"]);
  });

  // It sits among Inputs, so it is drawn like one; its placeholder was 50% currentColor (2.88:1).
  it("is drawn like Input, with a legible placeholder", () => {
    render(<Host id="tags" />);
    const input = screen.getByRole("textbox", { name: "Keywords" });
    const box = input.parentElement!.className.split(" ");
    expect(box).toEqual(
      expect.arrayContaining([
        "min-h-9",
        "rounded-md",
        "border-input",
        "px-3",
        "py-1",
        "focus-within:border-ring",
        "focus-within:ring-[3px]",
        "focus-within:ring-ring/50",
        "pointer-coarse:min-h-11",
      ]),
    );
    expect(box).not.toContain("rounded-lg");
    expect(input.className.split(" ")).toContain(
      "placeholder:text-muted-foreground",
    );
  });

  it("removes a tag with its own button or Backspace on an empty field", () => {
    render(<Host id="tags" initial={["ocean", "calm", "forest"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove calm" }));
    expect(tagsShown()).toEqual(["ocean", "forest"]);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Keywords" }), {
      key: "Backspace",
    });
    expect(tagsShown()).toEqual(["ocean"]);
  });
});

// The server refuses more than 20 tags, or a tag over 50 characters (SEC-26), so the input
// never builds a list it would refuse.
describe("TagInput bounds", () => {
  it("adds comma-separated tags up to the most a puzzle may carry", () => {
    render(<Host />);
    type(Array.from({ length: 25 }, (_, i) => `tag${i}`).join(", "));
    expect(tagsShown()).toHaveLength(MAX_CATALOG_TAGS);
    expect(tagsShown()[MAX_CATALOG_TAGS - 1]).toBe("tag19");
  });

  it("shortens an over-long tag to the tag limit", () => {
    render(<Host />);
    type("x".repeat(60));
    expect(tagsShown()).toEqual(["x".repeat(CATALOG_TEXT_LIMITS.tag)]);
  });

  it("takes no more tags once the list is full, and says why", () => {
    render(<Host initial={fullList()} />);
    const input = screen.getByLabelText("Tags");
    expect(input).toHaveProperty("readOnly", true);
    expect(input.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(`Up to ${MAX_CATALOG_TAGS} tags`)).toBeTruthy();
    expect(input.getAttribute("aria-describedby")).toBe(
      screen.getByText(`Up to ${MAX_CATALOG_TAGS} tags`).id,
    );
  });

  // A disabled input would drop keyboard focus to the page the moment the last tag is added.
  it("keeps keyboard focus on the input when the last tag fills the list", () => {
    render(<Host initial={fullList().slice(1)} />);
    const input = screen.getByLabelText("Tags");
    input.focus();
    type("last");
    expect(tagsShown()).toHaveLength(MAX_CATALOG_TAGS);
    expect(input.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it("still removes the last tag with Backspace when the list is full", () => {
    render(<Host initial={fullList()} />);
    fireEvent.keyDown(screen.getByLabelText("Tags"), { key: "Backspace" });
    expect(tagsShown()).toHaveLength(MAX_CATALOG_TAGS - 1);
    expect(screen.getByLabelText("Tags")).toHaveProperty("readOnly", false);
  });

  it("says why in Dutch too", () => {
    render(<Host initial={fullList()} locale="nl" />);
    expect(screen.getByText(`Maximaal ${MAX_CATALOG_TAGS} tags`)).toBeTruthy();
  });

  it("still takes tags below the limit, with no limit hint", () => {
    render(<Host initial={["a"]} />);
    expect(screen.getByLabelText("Tags")).toHaveProperty("readOnly", false);
    expect(screen.queryByText(`Up to ${MAX_CATALOG_TAGS} tags`)).toBeNull();
    type("b, c");
    expect(tagsShown()).toEqual(["a", "b", "c"]);
  });
});

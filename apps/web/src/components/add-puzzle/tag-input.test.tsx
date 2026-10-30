// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CATALOG_TEXT_LIMITS, MAX_CATALOG_TAGS } from "./catalog-text-limits";
import { TagInput } from "./tag-input";

// A controlled host, like the catalogue forms; exposes the current tags for assertions.
function Host({ initial = [] }: { initial?: string[] }) {
  const [tags, setTags] = useState<string[]>(initial);
  return (
    <>
      <TagInput value={tags} onChange={setTags} />
      <output data-testid="tags">{JSON.stringify(tags)}</output>
    </>
  );
}

const tagsShown = () =>
  JSON.parse(screen.getByTestId("tags").textContent ?? "[]") as string[];

const type = (text: string) => {
  const input = screen.getByLabelText("Tags");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
};

afterEach(cleanup);

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

  it("takes no more tags once the list is full", () => {
    render(
      <Host
        initial={Array.from({ length: MAX_CATALOG_TAGS }, (_, i) => `t${i}`)}
      />,
    );
    expect(screen.getByLabelText("Tags")).toHaveProperty("disabled", true);
  });

  it("still takes tags below the limit", () => {
    render(<Host initial={["a"]} />);
    expect(screen.getByLabelText("Tags")).toHaveProperty("disabled", false);
    type("b, c");
    expect(tagsShown()).toEqual(["a", "b", "c"]);
  });
});

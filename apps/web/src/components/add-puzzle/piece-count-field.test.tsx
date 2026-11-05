// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PieceCountField } from "./piece-count-field";

const Form = ({ start }: { start?: number }) => {
  const [value, setValue] = useState(start);
  return (
    <>
      <PieceCountField id="pieces" value={value} onChange={setValue} />
      <output>{value === undefined ? "none" : value}</output>
    </>
  );
};

const type = (value: string) =>
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value } });
const field = () => screen.getByRole<HTMLInputElement>("spinbutton").value;
const held = () => screen.getByRole("status").textContent;

afterEach(cleanup);

describe("PieceCountField", () => {
  it("takes a piece count up to the most the server accepts", () => {
    render(<Form />);
    type("1000000");
    expect(field()).toBe("1000000");
    expect(held()).toBe("1000000");
  });

  it("keeps the number when one more digit would pass the limit", () => {
    render(<Form start={1000000} />);
    type("10000000");
    expect(field()).toBe("1000000");
    expect(held()).toBe("1000000");
  });

  it.each(["0", "-5", "1.5"])(
    "ignores %s instead of blanking the field",
    (typed) => {
      render(<Form start={250} />);
      type(typed);
      expect(field()).toBe("250");
      expect(held()).toBe("250");
    },
  );

  it("clearing the field clears the value", () => {
    render(<Form start={250} />);
    type("");
    expect(field()).toBe("");
    expect(held()).toBe("none");
  });

  it("offers the presets", () => {
    render(<Form />);
    fireEvent.click(screen.getByRole("button", { name: "500" }));
    expect(held()).toBe("500");
  });
});

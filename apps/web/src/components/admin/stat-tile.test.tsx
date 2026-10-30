// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatTile } from "./stat-tile";

afterEach(cleanup);

describe("StatTile", () => {
  it("shows the count as it is", () => {
    render(<StatTile label="Copies" value={42} />);
    expect(screen.getByText("Copies").previousSibling?.textContent).toBe("42");
  });

  it("marks a count that stopped at a cap with a plus (SEC-71)", () => {
    render(<StatTile label="Copies" value={1000} atLeast />);
    expect(screen.getByText("Copies").previousSibling?.textContent).toBe(
      "1000+",
    );
  });
});

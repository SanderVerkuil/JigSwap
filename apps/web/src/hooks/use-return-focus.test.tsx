// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useReturnFocus } from "./use-return-focus";

// A dialog opened by state (no Radix trigger) closes with focus on <body> unless something hands
// it back to whatever opened it.

function Harness({ removeOpener = false }: { removeOpener?: boolean }) {
  const [open, setOpen] = useState(false);
  const openerRef = useReturnFocus(open);
  return (
    <>
      {!(removeOpener && open) && (
        <button
          onClick={(event) => {
            openerRef.current = event.currentTarget;
            setOpen(true);
          }}
        >
          opener
        </button>
      )}
      {open && (
        <>
          <input aria-label="inside" />
          <button onClick={() => setOpen(false)}>close</button>
        </>
      )}
    </>
  );
}

afterEach(cleanup);

const clickButton = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

describe("useReturnFocus", () => {
  it("hands focus back to the opener when the dialog closes", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "opener" });
    clickButton("opener");
    const inside = screen.getByRole("textbox", { name: "inside" });
    inside.focus();
    expect(document.activeElement).toBe(inside);

    clickButton("close");
    expect(document.activeElement).toBe(opener);
  });

  it("does nothing when the opener left the page in the meantime", () => {
    render(<Harness removeOpener />);
    clickButton("opener");
    expect(screen.queryByRole("button", { name: "opener" })).toBeNull();
    clickButton("close");
    expect(document.activeElement).toBe(document.body);
  });

  it("does not take focus on mount, with nothing opened yet", () => {
    render(<Harness />);
    expect(document.activeElement).toBe(document.body);
  });
});

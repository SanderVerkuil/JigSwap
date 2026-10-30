// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueueList } from "./queue-list";

// The viewport: wide (lg and up) or not, as the min-width media query reports it.
const setWide = (wide: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width") ? wide : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Row = { id: string; title: string };
const ROWS: Row[] = [
  { id: "a", title: "Alpine Lake" },
  { id: "b", title: "Busy Harbour" },
  { id: "c", title: "Cosy Kitchen" },
];

// Stands in for the route: owns the selection, renders the selected row's detail with an Approve
// that removes the row, selects its neighbour and asks for the detail's focus (as decideRow does).
function Harness({ defaultDetailOpen }: { defaultDetailOpen?: boolean }) {
  const [rows, setRows] = useState(ROWS);
  const [selectedId, setSelectedId] = useState<string | null>("a");
  const [focusToken, setFocusToken] = useState(0);
  const selected = rows.find((row) => row.id === selectedId);
  const approve = (id: string) => {
    const index = rows.findIndex((row) => row.id === id);
    const next = rows[index + 1] ?? rows[index - 1];
    setRows(rows.filter((row) => row.id !== id));
    setSelectedId(next ? next.id : null);
    setFocusToken((token) => token + 1);
  };
  return (
    <QueueList
      label="Submissions"
      items={rows}
      selectedId={selectedId}
      onSelect={setSelectedId}
      getId={(row) => row.id}
      renderRow={(row) => <span>{row.title}</span>}
      detail={
        selected && (
          <>
            <h3>Detail of {selected.title}</h3>
            <button type="button" onClick={() => approve(selected.id)}>
              Approve
            </button>
          </>
        )
      }
      detailTitle="Submission"
      focusDetailToken={focusToken}
      defaultDetailOpen={defaultDetailOpen}
    />
  );
}

const rowButton = (title: string) =>
  screen.getByRole("option", { name: title });
const tabStops = () =>
  screen.getAllByRole("option").filter((option) => option.tabIndex === 0);

describe("QueueList", () => {
  it("shows the detail next to the list from lg, without a sheet", () => {
    setWide(true);
    render(<Harness />);
    expect(screen.getByText("Detail of Alpine Lake")).toBeTruthy();

    fireEvent.click(rowButton("Busy Harbour"));
    expect(screen.getByText("Detail of Busy Harbour")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("below lg keeps the detail out of the page and opens it in a sheet on a row tap", () => {
    setWide(false);
    render(<Harness />);
    expect(screen.queryByText("Detail of Alpine Lake")).toBeNull();

    fireEvent.click(rowButton("Cosy Kitchen"));
    const sheet = screen.getByRole("dialog", { name: "Submission" });
    expect(sheet.textContent).toContain("Detail of Cosy Kitchen");

    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is one listbox with a single Tab stop on the selected row", () => {
    setWide(true);
    render(<Harness />);
    const list = screen.getByRole("listbox", { name: "Submissions" });
    const options = screen.getAllByRole("option");
    expect(list.contains(options[0])).toBe(true);
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(tabStops()).toEqual([rowButton("Alpine Lake")]);
  });

  it("moves the selection and focus with the arrow keys, Home and End", () => {
    setWide(true);
    render(<Harness />);
    const first = rowButton("Alpine Lake");
    first.focus();

    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rowButton("Busy Harbour"));
    expect(rowButton("Busy Harbour").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByText("Detail of Busy Harbour")).toBeTruthy();
    expect(tabStops()).toEqual([rowButton("Busy Harbour")]);

    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(rowButton("Cosy Kitchen"));
    // Past the end stays put.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rowButton("Cosy Kitchen"));

    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(rowButton("Busy Harbour"));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(first);
    expect(screen.getByText("Detail of Alpine Lake")).toBeTruthy();
  });

  it("Enter takes a keyboard reviewer from the row into its detail", () => {
    setWide(true);
    render(<Harness />);
    const row = rowButton("Busy Harbour");
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    const detail = screen.getByRole("region", { name: "Submission" });
    expect(document.activeElement).toBe(detail);
    expect(detail.textContent).toContain("Detail of Busy Harbour");
  });

  it("after a decision focus lands on the detail, not on the next item's Approve", () => {
    setWide(true);
    render(<Harness />);
    const approve = screen.getByRole("button", { name: "Approve" });
    approve.focus();
    fireEvent.click(approve);

    const detail = screen.getByRole("region", { name: "Submission" });
    expect(detail.textContent).toContain("Detail of Busy Harbour");
    expect(document.activeElement).toBe(detail);
  });

  it("below lg Enter opens the row's sheet; the arrows only move the selection", () => {
    setWide(false);
    render(<Harness />);
    const first = rowButton("Alpine Lake");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: " " });
    expect(
      screen.getByRole("dialog", { name: "Submission" }).textContent,
    ).toContain("Detail of Busy Harbour");
  });

  it("below lg opens the sheet straight away for a linked item", () => {
    setWide(false);
    render(<Harness defaultDetailOpen />);
    expect(
      screen.getByRole("dialog", { name: "Submission" }).textContent,
    ).toContain("Detail of Alpine Lake");
  });
});

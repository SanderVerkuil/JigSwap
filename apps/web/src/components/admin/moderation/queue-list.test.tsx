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

// Stands in for the route: owns the selection and renders the selected row's detail.
function Harness({ defaultDetailOpen }: { defaultDetailOpen?: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>("a");
  const selected = ROWS.find((row) => row.id === selectedId);
  return (
    <QueueList
      items={ROWS}
      selectedId={selectedId}
      onSelect={setSelectedId}
      getId={(row) => row.id}
      renderRow={(row) => <span>{row.title}</span>}
      detail={selected && <h3>Detail of {selected.title}</h3>}
      detailTitle="Submission"
      defaultDetailOpen={defaultDetailOpen}
    />
  );
}

const rowButton = (title: string) => screen.getByText(title).closest("button")!;

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

  it("below lg opens the sheet straight away for a linked item", () => {
    setWide(false);
    render(<Harness defaultDetailOpen />);
    expect(
      screen.getByRole("dialog", { name: "Submission" }).textContent,
    ).toContain("Detail of Alpine Lake");
  });
});

// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useDocumentTitle } from "./use-document-title";

function Page({ title }: { title?: string }) {
  useDocumentTitle(title);
  return null;
}

beforeEach(() => {
  document.title = "Puzzle details — JigSwap";
});
afterEach(cleanup);

describe("useDocumentTitle", () => {
  it("takes over the tab title once the data is in", () => {
    const { rerender } = render(<Page />);
    expect(document.title).toBe("Puzzle details — JigSwap");
    rerender(<Page title="Café — JigSwap" />);
    expect(document.title).toBe("Café — JigSwap");
  });

  it("gives it back on leaving for a route with the same title, which won't write it again", () => {
    const { unmount } = render(<Page title="Café — JigSwap" />);
    unmount();
    expect(document.title).toBe("Puzzle details — JigSwap");
  });

  it("leaves the title of the route it left for alone", () => {
    const { unmount } = render(<Page title="Café — JigSwap" />);
    // The next route's <title> lands in the commit, before this page's effects clean up.
    document.title = "Browse puzzles — JigSwap";
    unmount();
    expect(document.title).toBe("Browse puzzles — JigSwap");
  });

  it("follows a move to another thread, through the static title while it loads", () => {
    const { rerender } = render(<Page title="Mara — Messages — JigSwap" />);
    rerender(<Page />);
    expect(document.title).toBe("Puzzle details — JigSwap");
    rerender(<Page title="Sander — Messages — JigSwap" />);
    expect(document.title).toBe("Sander — Messages — JigSwap");
  });
});

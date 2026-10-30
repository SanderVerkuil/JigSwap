import { describe, expect, it, vi } from "vitest";
import type { SearchDoc } from "./search";
import { createDocsSearchStore } from "./search-store";

const DOCS: SearchDoc[] = [
  {
    id: "your-library/collections",
    slug: "your-library/collections",
    title: "Collections",
    group: "your-library",
    summary: "",
    text: "Create a collection to group puzzles together.",
  },
];

describe("createDocsSearchStore", () => {
  it("loads nothing until asked", () => {
    const loadDocs = vi.fn(async () => DOCS);
    const store = createDocsSearchStore(loadDocs);
    expect(store.get("en")).toBeUndefined();
    expect(loadDocs).not.toHaveBeenCalled();
  });

  it("loads a locale's corpus once and notifies subscribers with a ready index", async () => {
    const loadDocs = vi.fn(async () => DOCS);
    const store = createDocsSearchStore(loadDocs);
    const listener = vi.fn();
    store.subscribe(listener);

    await Promise.all([store.load("en"), store.load("en")]);
    await store.load("en");

    expect(loadDocs).toHaveBeenCalledTimes(1);
    expect(loadDocs).toHaveBeenCalledWith("en");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get("en")?.search("collection")[0]?.slug).toBe(
      "your-library/collections",
    );
  });

  it("keeps one index per locale", async () => {
    const loadDocs = vi.fn(async () => DOCS);
    const store = createDocsSearchStore(loadDocs);
    await store.load("en");
    expect(store.get("nl")).toBeUndefined();
    await store.load("nl");
    expect(loadDocs).toHaveBeenLastCalledWith("nl");
    expect(store.get("nl")).not.toBe(store.get("en"));
  });

  it("retries on the next load after a failed one", async () => {
    const loadDocs = vi
      .fn<(locale: string) => Promise<SearchDoc[]>>()
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockResolvedValue(DOCS);
    const store = createDocsSearchStore(loadDocs);

    await store.load("en");
    expect(store.get("en")).toBeUndefined();

    await store.load("en");
    expect(loadDocs).toHaveBeenCalledTimes(2);
    expect(store.get("en")).toBeDefined();
  });

  it("stops notifying after unsubscribe", async () => {
    const store = createDocsSearchStore(async () => DOCS);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    await store.load("en");
    expect(listener).not.toHaveBeenCalled();
  });
});

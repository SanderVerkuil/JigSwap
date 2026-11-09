// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { categoryOptions } from "./category-options";
import { PuzzleFilters } from "./puzzle-filters";

const category = (id: string, en: string, nl: string) => ({
  _id: id,
  _creationTime: 1,
  name: { en, nl },
  isActive: true,
  sortOrder: 1,
  createdAt: 1,
  updatedAt: 1,
});

interface Filters {
  searchTerm: string;
  brand: string;
  minPieces: string;
  maxPieces: string;
  difficulty: string;
  category: string;
  tags: string[];
}

const emptyFilters: Filters = {
  searchTerm: "",
  brand: "",
  minPieces: "",
  maxPieces: "",
  difficulty: "",
  category: "",
  tags: [],
};

// What an unseeded read does: stay in flight, or fail the way the live brand read did
// ("undefined is not a valid Convex value").
type Unseeded = "pending" | "error";
const unseededFn = (mode: Unseeded) => () =>
  mode === "pending"
    ? new Promise<never>(() => {})
    : Promise.reject(new Error("undefined is not a valid Convex value"));

const brandsKey = convexQuery(gateway.catalog.allBrands, {}).queryKey;
const tagsKey = convexQuery(gateway.catalog.allTags, {}).queryKey;
const categoriesKey = convexQuery(
  gateway.catalog.puzzleCategories,
  {},
).queryKey;

// Seeds only the public reads (the admin-only category listAll is never seeded, so asking for it
// would leave the category control loading). `brands`/`tags` left undefined stay unseeded.
const renderFilters = ({
  brands,
  tags = [],
  unseeded = "pending",
  filters = emptyFilters,
  onFiltersChange = () => {},
}: {
  brands?: string[];
  tags?: string[] | null;
  unseeded?: Unseeded;
  filters?: Filters;
  onFiltersChange?: (patch: Partial<Filters>) => void;
} = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: unseededFn(unseeded) },
    },
  });
  if (brands) queryClient.setQueryData(brandsKey, brands);
  if (tags) queryClient.setQueryData(tagsKey, tags);
  queryClient.setQueryData(categoriesKey, [
    category("cat_1", "Animals", "Dieren"),
  ]);
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <PuzzleFilters filters={filters} onFiltersChange={onFiltersChange} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const combobox = (name: string) => screen.getByRole("combobox", { name });

// Opens a select by keyboard and lists its option labels.
const optionsOf = (name: string) => {
  fireEvent.keyDown(combobox(name), { key: "Enter" });
  return within(screen.getByRole("listbox"))
    .getAllByRole("option")
    .map((option) => option.textContent);
};

afterEach(cleanup);

describe("PuzzleFilters", () => {
  it("renders the category filter from the public taxonomy read", () => {
    renderFilters({ brands: [] });
    expect(combobox("Category")).toBeTruthy();
  });

  it("shows the other filters while the brand list is still loading", () => {
    renderFilters();
    expect(combobox("Category")).toBeTruthy();
    expect(combobox("Difficulty")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Brand" })).toBeNull();
  });

  it("disables only the brand filter when the brand list fails to load", async () => {
    renderFilters({ unseeded: "error" });
    await vi.waitFor(() =>
      expect(screen.getByText("Couldn't load brands")).toBeTruthy(),
    );
    expect(combobox("Brand").hasAttribute("disabled")).toBe(true);
    expect(combobox("Difficulty").hasAttribute("disabled")).toBe(false);
    expect(combobox("Category").hasAttribute("disabled")).toBe(false);
  });

  it("keeps a tag-list failure to the tags block", async () => {
    renderFilters({ brands: ["Ravensburger"], tags: null, unseeded: "error" });
    await vi.waitFor(() =>
      expect(screen.getByText("Couldn't load tags")).toBeTruthy(),
    );
    expect(combobox("Brand").hasAttribute("disabled")).toBe(false);
  });

  it.each([
    ["Brand", ["All brands", "Ravensburger"]],
    ["Category", ["All categories", "Animals"]],
    ["Difficulty", ["All difficulties", "Easy", "Medium", "Hard", "Expert"]],
  ])("offers an explicit 'all' choice in the %s select", (name, expected) => {
    renderFilters({ brands: ["Ravensburger"] });
    expect(optionsOf(name)).toEqual(expected);
  });

  describe("piece count", () => {
    const pieces = () => screen.getByRole("group", { name: "Pieces" });
    const bound = (name: string) =>
      screen.getByRole("spinbutton", { name }) as HTMLInputElement;
    const preset = (name: string) =>
      within(pieces()).getByRole("button", { name });

    it("is one row: two number inputs and presets, no selects", () => {
      renderFilters({ brands: [] });
      expect(screen.queryByRole("combobox", { name: "Min Pieces" })).toBeNull();
      expect(screen.queryByRole("combobox", { name: "Max Pieces" })).toBeNull();
      expect(bound("Min Pieces").getAttribute("placeholder")).toBe("Min");
      expect(bound("Max Pieces").getAttribute("placeholder")).toBe("Max");
      expect(preset("1,000 pieces")).toBeTruthy();
    });

    it("shows any value in the URL in the inputs", () => {
      renderFilters({
        brands: [],
        filters: { ...emptyFilters, minPieces: "777", maxPieces: "1000" },
      });
      expect(bound("Min Pieces").value).toBe("777");
      expect(bound("Max Pieces").value).toBe("1000");
    });

    it("sets both bounds from a preset, and clears them when it is pressed again", () => {
      const onFiltersChange = vi.fn();
      const { unmount } = renderFilters({ brands: [], onFiltersChange });
      expect(preset("1,000 pieces").getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(preset("1,000 pieces"));
      expect(onFiltersChange).toHaveBeenLastCalledWith({
        minPieces: "1000",
        maxPieces: "1000",
      });
      unmount();

      renderFilters({
        brands: [],
        onFiltersChange,
        filters: { ...emptyFilters, minPieces: "1000", maxPieces: "1000" },
      });
      expect(preset("1,000 pieces").getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(preset("1,000 pieces"));
      expect(onFiltersChange).toHaveBeenLastCalledWith({
        minPieces: "",
        maxPieces: "",
      });
    });

    // The tint alone sits close to the hover fill: the picked preset also gets an edge.
    it("marks the picked preset with an edge as well as the tint", () => {
      renderFilters({
        brands: [],
        filters: { ...emptyFilters, minPieces: "1000", maxPieces: "1000" },
      });
      expect(preset("1,000 pieces").className).toContain("ring-primary-text");
      expect(preset("500 pieces").className).not.toContain("ring-");
    });
  });

  it("clears a filter when its 'all' choice is picked", () => {
    const onFiltersChange = vi.fn();
    renderFilters({
      brands: ["Ravensburger"],
      filters: { ...emptyFilters, brand: "Ravensburger", difficulty: "hard" },
      onFiltersChange,
    });
    fireEvent.keyDown(combobox("Brand"), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "All brands" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ brand: "" });
  });
});

describe("categoryOptions", () => {
  const categories = [
    category("cat_2", "Maps", "Landkaarten"),
    category("cat_1", "Animals", "Dieren"),
  ];

  it("keys each option by the adminCategories _id a puzzle's category holds, keeping order", () => {
    expect(categoryOptions(categories, "en")).toEqual([
      { value: "cat_2", label: "Maps" },
      { value: "cat_1", label: "Animals" },
    ]);
  });

  it("labels options in the UI locale, falling back to English when blank", () => {
    expect(
      categoryOptions(
        [...categories, category("cat_3", "Transport", "  ")],
        "nl",
      ).map((option) => option.label),
    ).toEqual(["Landkaarten", "Dieren", "Transport"]);
  });
});

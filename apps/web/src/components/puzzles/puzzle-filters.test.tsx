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
  onFiltersChange?: (filters: Filters) => void;
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
    expect(combobox("Min Pieces")).toBeTruthy();
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

  it.each([
    ["Min Pieces", "No minimum"],
    ["Max Pieces", "No maximum"],
  ])("offers a 'no limit' choice in the %s select", (name, first) => {
    renderFilters({ brands: [] });
    expect(optionsOf(name)[0]).toBe(first);
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
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...emptyFilters,
      brand: "",
      difficulty: "hard",
    });
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

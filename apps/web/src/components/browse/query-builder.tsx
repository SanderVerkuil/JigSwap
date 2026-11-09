"use client";

// Browse query builder: an open, card-free area where members compose multiple
// narrowing conditions (combined with AND) to discover owned puzzles: the search
// box, always on screen as in the catalogue's toolbar, and facets (category /
// condition / difficulty / piece range / availability).
//
// UX shape: the search box with "Add Filter" (a themed Popover + Command menu
// listing the facets not already on screen) and "Clear All" beside it, and below
// them the chosen facets as removable, themed inline controls that wrap. Every
// control carries its own remove (×) button. Active accents use the brand violet
// (bg-jigsaw-primary), never the near-black --primary, per the design language.
import { useConditionLabel } from "@/components/library/condition";
import { ToolbarSearch } from "@/components/puzzles/toolbar-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AVAILABILITY_FLAGS,
  CONDITIONS,
  type AvailabilityFlag,
  type BrowseFilters,
  type Condition,
} from "@/lib/browse-search";
import { DIFFICULTIES, type Difficulty } from "@/lib/catalogue-filters";
import { cn } from "@/lib/utils";
import { Plus, X } from "lucide-react";
import { useRef, useState } from "react";

/* ----------------------------------------------------------------- types */

// The full, controlled state of the builder: the free text plus the filters the
// URL carries (lib/browse-search). The page owns this object and maps it onto
// the browse query, which applies every condition on the server.
export interface QueryBuilderState extends BrowseFilters {
  text: string;
}

export const EMPTY_QUERY: QueryBuilderState = {
  text: "",
  category: "",
  condition: "",
  difficulty: "",
  minPieces: "",
  maxPieces: "",
  availability: [],
};

// Identifiers for the distinct conditions a member can add. Pieces (min/max) is a
// single condition that exposes two inputs; availability is a single condition
// that exposes a multi-toggle.
type FieldKey =
  "category" | "condition" | "difficulty" | "pieces" | "availability";

export interface CategoryOption {
  id: string;
  name: string;
}

interface QueryBuilderProps {
  value: QueryBuilderState;
  onChange: (next: QueryBuilderState) => void;
  categories: CategoryOption[];
  // Translators are passed in so the builder stays presentational and the page
  // owns the namespaces (`browse` for builder chrome, `puzzles` for enum labels).
  // Condition labels come from the app-wide condition vocabulary instead.
  tBrowse: (key: string) => string;
  tEnum: (key: string) => string;
}

/* ------------------------------------------------------------- component */

export function QueryBuilder({
  value,
  onChange,
  categories,
  tBrowse,
  tEnum,
}: QueryBuilderProps) {
  const conditionLabel = useConditionLabel();
  const [addOpen, setAddOpen] = useState(false);
  // A removed condition's × (and Clear All) unmounts with it: focus moves here first, so keyboard
  // and screen-reader users stay in the filters instead of restarting from the top of the page.
  const addFilterRef = useRef<HTMLButtonElement>(null);
  // Which Select should auto-open after being added, and which control to focus.
  const [openSelect, setOpenSelect] = useState<FieldKey | null>(null);
  const [pendingFocus, setPendingFocus] = useState<FieldKey | null>(null);
  // Fields the member has explicitly added but may not have filled in yet. A
  // control is rendered when it's revealed OR already holds a value, so picking
  // "Piece Count" from the menu shows empty inputs ready to type into.
  const [revealed, setRevealed] = useState<Set<FieldKey>>(new Set());

  // A condition is "active" once it holds a value; that drives the live result
  // count semantics and "Clear All" visibility.
  const active: Record<FieldKey, boolean> = {
    category: value.category !== "",
    condition: value.condition !== "",
    difficulty: value.difficulty !== "",
    pieces: value.minPieces !== "" || value.maxPieces !== "",
    availability: value.availability.length > 0,
  };

  // A field's control is shown if the member revealed it or it carries a value.
  const shown: Record<FieldKey, boolean> = {
    category: revealed.has("category") || active.category,
    condition: revealed.has("condition") || active.condition,
    difficulty: revealed.has("difficulty") || active.difficulty,
    pieces: revealed.has("pieces") || active.pieces,
    availability: revealed.has("availability") || active.availability,
  };

  const fieldLabels: Record<FieldKey, string> = {
    category: tEnum("category"),
    condition: tEnum("condition"),
    difficulty: tEnum("difficulty"),
    pieces: tEnum("pieceCount"),
    availability: tBrowse("fieldAvailability"),
  };

  const order: FieldKey[] = [
    "category",
    "condition",
    "difficulty",
    "pieces",
    "availability",
  ];

  const set = (patch: Partial<QueryBuilderState>) =>
    onChange({ ...value, ...patch });

  const reveal = (field: FieldKey) =>
    setRevealed((prev) => new Set(prev).add(field));

  const unreveal = (field: FieldKey) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      next.delete(field);
      return next;
    });

  // Adding a field from the menu reveals its (empty) control and focuses it; the
  // member then fills it in. The faceted Selects auto-open on add for one fewer
  // click. No value is seeded, so the live result count is unaffected until the
  // member actually picks something.
  const addField = (field: FieldKey) => {
    setAddOpen(false);
    reveal(field);
    setPendingFocus(field);
    if (
      field === "category" ||
      field === "condition" ||
      field === "difficulty"
    ) {
      setOpenSelect(field);
    }
  };

  const removeField = (field: FieldKey) => {
    addFilterRef.current?.focus();
    unreveal(field);
    if (openSelect === field) setOpenSelect(null);
    if (pendingFocus === field) setPendingFocus(null);
    switch (field) {
      case "category":
        set({ category: "" });
        break;
      case "condition":
        set({ condition: "" });
        break;
      case "difficulty":
        set({ difficulty: "" });
        break;
      case "pieces":
        set({ minPieces: "", maxPieces: "" });
        break;
      case "availability":
        set({ availability: [] });
        break;
    }
  };

  const clearAll = () => {
    addFilterRef.current?.focus();
    setRevealed(new Set());
    setOpenSelect(null);
    setPendingFocus(null);
    onChange(EMPTY_QUERY);
  };

  const toggleAvailability = (flag: AvailabilityFlag) => {
    const next = value.availability.includes(flag)
      ? value.availability.filter((f) => f !== flag)
      : [...value.availability, flag];
    set({ availability: next });
  };

  // The Add menu offers any field whose control isn't already on screen.
  const availableFields = order.filter((f) => !shown[f]);
  const anyChips = order.some((f) => shown[f]);
  const canClear = anyChips || value.text.trim().length > 0;

  return (
    <div className="flex max-w-full min-w-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <ToolbarSearch
          label={tBrowse("searchLabel")}
          placeholder={tBrowse("textPlaceholder")}
          value={value.text}
          onChange={(text) => set({ text })}
        />
        <div className="flex flex-wrap items-center gap-2">
          {/* Add Filter — themed Popover + Command list of the fields not yet added. */}
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              {/* Never disabled, or it couldn't take that focus: with every condition on screen its
                menu says none are left. */}
              <Button
                ref={addFilterRef}
                type="button"
                variant="outline"
                aria-label={tBrowse("addFilter")}
              >
                <Plus className="h-4 w-4" />
                {tBrowse("addFilter")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-0">
              <Command>
                <CommandInput placeholder={tBrowse("addFilterSearch")} />
                <CommandList>
                  <CommandEmpty>{tBrowse("noFilters")}</CommandEmpty>
                  <CommandGroup>
                    {availableFields.map((field) => (
                      <CommandItem
                        key={field}
                        value={fieldLabels[field]}
                        onSelect={() => addField(field)}
                      >
                        {fieldLabels[field]}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {canClear && (
            <Button type="button" variant="ghost" onClick={clearAll}>
              {tBrowse("clearFilters")}
            </Button>
          )}
        </div>
      </div>

      {/* Active condition controls, in a stable order, each removable. */}
      {anyChips && (
        <div className="flex flex-wrap items-center gap-2">
          {shown.category && (
            <ConditionShell
              label={fieldLabels.category}
              onRemove={() => removeField("category")}
              removeLabel={tBrowse("removeFilter")}
            >
              <FacetSelect
                open={openSelect === "category"}
                onOpenChange={(o) => setOpenSelect(o ? "category" : null)}
                value={value.category}
                onValueChange={(v) => set({ category: v })}
                placeholder={tBrowse("allCategories")}
                ariaLabel={fieldLabels.category}
                options={categories.map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
              />
            </ConditionShell>
          )}

          {shown.condition && (
            <ConditionShell
              label={fieldLabels.condition}
              onRemove={() => removeField("condition")}
              removeLabel={tBrowse("removeFilter")}
            >
              <FacetSelect
                open={openSelect === "condition"}
                onOpenChange={(o) => setOpenSelect(o ? "condition" : null)}
                value={value.condition}
                onValueChange={(v) => set({ condition: v as Condition })}
                placeholder={tBrowse("allConditions")}
                ariaLabel={fieldLabels.condition}
                options={CONDITIONS.map((c) => ({
                  value: c,
                  label: conditionLabel(c),
                }))}
              />
            </ConditionShell>
          )}

          {shown.difficulty && (
            <ConditionShell
              label={fieldLabels.difficulty}
              onRemove={() => removeField("difficulty")}
              removeLabel={tBrowse("removeFilter")}
            >
              <FacetSelect
                open={openSelect === "difficulty"}
                onOpenChange={(o) => setOpenSelect(o ? "difficulty" : null)}
                value={value.difficulty}
                onValueChange={(v) => set({ difficulty: v as Difficulty })}
                placeholder={tBrowse("allDifficulties")}
                ariaLabel={fieldLabels.difficulty}
                options={DIFFICULTIES.map((d) => ({
                  value: d,
                  label: tEnum(d),
                }))}
              />
            </ConditionShell>
          )}

          {shown.pieces && (
            <ConditionShell
              label={fieldLabels.pieces}
              onRemove={() => removeField("pieces")}
              removeLabel={tBrowse("removeFilter")}
            >
              <div className="flex min-w-0 items-center gap-1">
                <Input
                  autoFocus={pendingFocus === "pieces"}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={value.minPieces}
                  onChange={(e) => set({ minPieces: e.target.value })}
                  onBlur={() => setPendingFocus(null)}
                  placeholder={tBrowse("min")}
                  aria-label={tBrowse("minPieces")}
                  className="h-8 max-w-20 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
                />
                <span className="text-muted-foreground text-xs">–</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={value.maxPieces}
                  onChange={(e) => set({ maxPieces: e.target.value })}
                  placeholder={tBrowse("max")}
                  aria-label={tBrowse("maxPieces")}
                  className="h-8 max-w-20 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
                />
              </div>
            </ConditionShell>
          )}

          {shown.availability && (
            <ConditionShell
              label={fieldLabels.availability}
              onRemove={() => removeField("availability")}
              removeLabel={tBrowse("removeFilter")}
            >
              <div
                className="flex min-w-0 flex-wrap items-center gap-1"
                role="group"
              >
                {AVAILABILITY_FLAGS.map((flag) => {
                  const on = value.availability.includes(flag);
                  const labelKey =
                    flag === "forTrade"
                      ? "trade"
                      : flag === "forLend"
                        ? "lend"
                        : "sale";
                  return (
                    <Button
                      key={flag}
                      type="button"
                      size="sm"
                      variant={on ? "default" : "outline"}
                      aria-pressed={on}
                      onClick={() => toggleAvailability(flag)}
                      className={cn(
                        "h-7 rounded-full px-2.5 text-xs",
                        on &&
                          "bg-jigsaw-primary text-white hover:bg-jigsaw-primary/90",
                      )}
                    >
                      {tEnum(labelKey)}
                    </Button>
                  );
                })}
              </div>
            </ConditionShell>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- sub-components */

// A themed pill wrapper around one active condition: a brand-tinted label, the
// field's control, and a remove button. Open and rounded, never a boxed card. It
// never outgrows the row, so the × stays on screen on a phone: the control gives
// way (a select truncates, the availability toggles wrap, the piece inputs narrow),
// and a fixed radius keeps the shape when wrapping makes the pill taller.
function ConditionShell({
  label,
  onRemove,
  removeLabel,
  children,
}: {
  label: string;
  onRemove: () => void;
  removeLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-input bg-card flex max-w-full min-w-0 items-center gap-1.5 rounded-[20px] border py-0.5 pr-1 pl-2.5">
      <Badge
        variant="outline"
        className="border-jigsaw-primary/30 text-primary-text bg-jigsaw-primary/10 shrink-0 rounded-full px-2 py-0 text-[11px] font-medium"
      >
        {label}
      </Badge>
      {children}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label={`${removeLabel}: ${label}`}
        className="text-muted-foreground hover:text-foreground size-6 shrink-0 rounded-full"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// A compact, unboxed Select used inside a ConditionShell. Renders the chosen
// label as plain text so the surrounding pill owns the chrome.
function FacetSelect({
  open,
  onOpenChange,
  value,
  onValueChange,
  placeholder,
  ariaLabel,
  options,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select
      open={open}
      onOpenChange={onOpenChange}
      value={value || undefined}
      onValueChange={onValueChange}
    >
      <SelectTrigger
        size="sm"
        aria-label={ariaLabel}
        className="h-8 min-w-0 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate"
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

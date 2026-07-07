"use client";

// Browse query builder: an open, card-free area where members compose multiple
// narrowing conditions (combined with AND) to discover owned puzzles. One of the
// conditions is the free-text filter the catalog used to expose directly; the
// rest are faceted (category / condition / difficulty / piece range / availability).
//
// UX shape: an "Add Filter" affordance (a themed Popover + Command menu listing
// the fields not already on screen) on the left, and the chosen conditions
// rendered as removable, themed inline controls that wrap on the same row. Every
// control carries its own remove (×) button; "Clear All" resets everything and a
// muted live result count sits on the right. Active accents use the brand violet
// (bg-jigsaw-primary), never the near-black --primary, per the design language.

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
import { cn } from "@/lib/utils";
import { Plus, X } from "lucide-react";
import { useState } from "react";

/* ----------------------------------------------------------------- types */

export type Difficulty = "easy" | "medium" | "hard" | "expert";
export type Condition = "new_sealed" | "like_new" | "good" | "fair" | "poor";
export type AvailabilityFlag = "forTrade" | "forLend" | "forSale";

export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "expert"];
export const CONDITIONS: Condition[] = [
  "new_sealed",
  "like_new",
  "good",
  "fair",
  "poor",
];
export const AVAILABILITY_FLAGS: AvailabilityFlag[] = [
  "forTrade",
  "forLend",
  "forSale",
];

// The full, controlled state of the builder. The page owns this object and maps
// it onto the browse query (server-side where supported, client-side otherwise).
export interface QueryBuilderState {
  text: string;
  category: string;
  condition: Condition | "";
  difficulty: Difficulty | "";
  minPieces: string;
  maxPieces: string;
  availability: AvailabilityFlag[];
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
  "text" | "category" | "condition" | "difficulty" | "pieces" | "availability";

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
  const [addOpen, setAddOpen] = useState(false);
  // Which Select should auto-open after being added, and which control to focus.
  const [openSelect, setOpenSelect] = useState<FieldKey | null>(null);
  const [pendingFocus, setPendingFocus] = useState<FieldKey | null>(null);
  // Fields the member has explicitly added but may not have filled in yet. A
  // control is rendered when it's revealed OR already holds a value, so picking
  // "Text" from the menu shows an empty input ready to type into.
  const [revealed, setRevealed] = useState<Set<FieldKey>>(new Set());

  // A condition is "active" once it holds a value; that drives the live result
  // count semantics and "Clear All" visibility.
  const active: Record<FieldKey, boolean> = {
    text: value.text.trim().length > 0,
    category: value.category !== "",
    condition: value.condition !== "",
    difficulty: value.difficulty !== "",
    pieces: value.minPieces !== "" || value.maxPieces !== "",
    availability: value.availability.length > 0,
  };

  // A field's control is shown if the member revealed it or it carries a value.
  const shown: Record<FieldKey, boolean> = {
    text: revealed.has("text") || active.text,
    category: revealed.has("category") || active.category,
    condition: revealed.has("condition") || active.condition,
    difficulty: revealed.has("difficulty") || active.difficulty,
    pieces: revealed.has("pieces") || active.pieces,
    availability: revealed.has("availability") || active.availability,
  };

  const fieldLabels: Record<FieldKey, string> = {
    text: tBrowse("fieldText"),
    category: tEnum("category"),
    condition: tEnum("condition"),
    difficulty: tEnum("difficulty"),
    pieces: tEnum("pieceCount"),
    availability: tBrowse("fieldAvailability"),
  };

  const order: FieldKey[] = [
    "text",
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
    unreveal(field);
    if (openSelect === field) setOpenSelect(null);
    if (pendingFocus === field) setPendingFocus(null);
    switch (field) {
      case "text":
        set({ text: "" });
        break;
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
  const anyShown = order.some((f) => shown[f]);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {/* Add Filter — themed Popover + Command list of the fields not yet added. */}
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={availableFields.length === 0}
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

        {/* Active condition controls, in a stable order, each removable. */}
        {shown.text && (
          <ConditionShell
            label={fieldLabels.text}
            onRemove={() => removeField("text")}
            removeLabel={tBrowse("removeFilter")}
          >
            <Input
              autoFocus={pendingFocus === "text"}
              value={value.text}
              onChange={(e) => set({ text: e.target.value })}
              onBlur={() => setPendingFocus(null)}
              placeholder={tBrowse("textPlaceholder")}
              aria-label={fieldLabels.text}
              className="h-8 w-44 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
            />
          </ConditionShell>
        )}

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
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
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
              options={CONDITIONS.map((c) => ({ value: c, label: tEnum(c) }))}
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
              options={DIFFICULTIES.map((d) => ({ value: d, label: tEnum(d) }))}
            />
          </ConditionShell>
        )}

        {shown.pieces && (
          <ConditionShell
            label={fieldLabels.pieces}
            onRemove={() => removeField("pieces")}
            removeLabel={tBrowse("removeFilter")}
          >
            <div className="flex items-center gap-1">
              <Input
                autoFocus={pendingFocus === "pieces"}
                type="number"
                inputMode="numeric"
                min={0}
                value={value.minPieces}
                onChange={(e) => set({ minPieces: e.target.value })}
                onBlur={() => setPendingFocus(null)}
                placeholder={tBrowse("minPieces")}
                aria-label={tBrowse("minPieces")}
                className="h-8 w-20 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
              <span className="text-muted-foreground text-xs">–</span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={value.maxPieces}
                onChange={(e) => set({ maxPieces: e.target.value })}
                placeholder={tBrowse("maxPieces")}
                aria-label={tBrowse("maxPieces")}
                className="h-8 w-20 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
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
            <div className="flex items-center gap-1" role="group">
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

        {anyShown && (
          <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
            {tBrowse("clearFilters")}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- sub-components */

// A themed pill wrapper around one active condition: a brand-tinted label, the
// field's control, and a remove button. Open and rounded, never a boxed card.
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
    <div className="border-input bg-card flex items-center gap-1.5 rounded-full border py-0.5 pr-1 pl-2.5">
      <Badge
        variant="outline"
        className="border-jigsaw-primary/30 text-jigsaw-primary bg-jigsaw-primary/10 rounded-full px-2 py-0 text-[11px] font-medium"
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
        className="text-muted-foreground hover:text-foreground size-6 rounded-full"
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
        className="h-8 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
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

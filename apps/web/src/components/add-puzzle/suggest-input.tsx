import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { useState } from "react";
import { filterSuggestions } from "./filter-suggestions";

// A free-text Input with an optional suggestion dropdown (publisher/brand/series fields).
// Selecting a suggestion just calls onChange with it — any typed value stays valid, so this
// is a drop-in Input replacement, not a select. Pure presentation: the caller owns the value
// and fetches the suggestion pool.
export interface SuggestInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: readonly string[];
  placeholder?: string;
}

export function SuggestInput({
  id,
  value,
  onChange,
  suggestions,
  placeholder,
}: SuggestInputProps) {
  const [focused, setFocused] = useState(false);
  const matches = filterSuggestions(suggestions, value).slice(0, 8);
  const open = focused && matches.length > 0;

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          // Delay so a click on a CommandItem lands before the popover unmounts.
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          autoComplete="off"
        />
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        // Keep keystrokes in the input: the popover must never steal focus.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              {matches.map((suggestion) => (
                <CommandItem
                  key={suggestion}
                  value={suggestion}
                  onSelect={() => {
                    onChange(suggestion);
                    setFocused(false);
                  }}
                >
                  {suggestion}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

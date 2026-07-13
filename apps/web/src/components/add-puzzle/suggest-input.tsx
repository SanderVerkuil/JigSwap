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
import { useEffect, useRef, useState } from "react";
import { filterSuggestions } from "./filter-suggestions";

// A free-text Input with an optional suggestion dropdown (publisher/brand/series fields).
// Selecting a suggestion just calls onChange with it — any typed value stays valid, so this
// is a drop-in Input replacement, not a select. Pure presentation: the caller owns the value
// and fetches the suggestion pool.
//
// The dropdown is deliberately pointer-only: focus stays in the input (the popover is a
// portalled sibling, so cmdk's arrow-key handling can't reach it), and we do NOT advertise
// combobox ARIA we can't honor — for keyboard and AT users this degrades to a plain text
// input, which stays fully operable. Escape dismisses the suggestions.
export interface SuggestInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Must be duplicate-free — entries are React keys and cmdk values. */
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
  // Dismissed-by-Escape: stays true until the value changes again, so the dropdown
  // doesn't pop right back over the still-focused input.
  const [dismissed, setDismissed] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(blurTimer.current), []);

  const matches = filterSuggestions(suggestions, value).slice(0, 8);
  const open = focused && !dismissed && matches.length > 0;

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <Input
          id={id}
          value={value}
          onChange={(e) => {
            setDismissed(false);
            onChange(e.target.value);
          }}
          onFocus={() => setFocused(true)}
          // Delay so a click on a CommandItem lands before the popover unmounts.
          onBlur={() => {
            blurTimer.current = setTimeout(() => setFocused(false), 150);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && open) {
              e.stopPropagation();
              setDismissed(true);
            }
          }}
          placeholder={placeholder}
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

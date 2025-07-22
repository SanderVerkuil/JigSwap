"use client";

import { api } from "@jigswap/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { ChevronsUpDown, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PuzzleSuggestion } from "@jigswap/backend/convex/puzzles";

interface PuzzleFormSuggestionsProps {
  value?: string;
  onChange?: (value: string) => void;
  onSuggestionUsed?: (suggestion: PuzzleSuggestion) => void;
  placeholder?: string;
}

export function PuzzleFormSuggestions({
  value = "",
  onChange,
  onSuggestionUsed,
  placeholder,
}: PuzzleFormSuggestionsProps) {
  const t = useTranslations("puzzles");
  const [searchValue, setSearchValue] = useState(value);
  const [open, setOpen] = useState(false);

  // Get puzzle suggestions from backend
  const suggestions = useQuery(
    api.puzzles.getPuzzleSuggestions,
    searchValue && searchValue.length >= 1
      ? { searchTerm: searchValue, limit: 10 }
      : "skip",
  );

  const applySuggestion = (suggestion: PuzzleSuggestion) => {
    setOpen(false);
    setSearchValue(suggestion.title);

    onChange?.(suggestion.title);
    onSuggestionUsed?.(suggestion);
  };

  const handleInputChange = (value: string) => {
    setSearchValue(value);
    onChange?.(value);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-10 px-3 py-2 text-sm"
        >
          {searchValue || placeholder || t("suggestions.placeholder")}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[600px] max-w-[90vw] p-0" align="start">
        <Command>
          <CommandInput
            placeholder={t("suggestions.searchPlaceholder")}
            value={searchValue}
            onValueChange={handleInputChange}
          />
          <CommandList>
            <CommandEmpty>
              {!searchValue ? (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">
                    {t("suggestions.typeToSearch")}
                  </p>
                </div>
              ) : suggestions === undefined ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-sm text-muted-foreground">
                    {t("suggestions.loading")}
                  </span>
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">
                    {t("suggestions.noResults")}
                  </p>
                </div>
              )}
            </CommandEmpty>
            <CommandGroup>
              {suggestions?.map((suggestion) => (
                <CommandItem
                  key={`${suggestion.title} ${suggestion.brand} ${suggestion.tags?.join(", ")}`}
                  value={`${suggestion.title} ${suggestion.brand} ${suggestion.tags?.join(", ")}`}
                  onSelect={() => applySuggestion(suggestion)}
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {suggestion.title}
                    </div>
                    <div className="flex flex-wrap gap-1 text-xs">
                      {suggestion.brand && (
                        <Badge variant="secondary" className="text-xs">
                          {suggestion.brand}
                        </Badge>
                      )}
                    </div>
                    {suggestion.tags && suggestion.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {suggestion.tags.slice(0, 2).map((tag: string) => (
                          <Badge
                            key={tag}
                            variant="outline"
                            className="text-xs"
                          >
                            {tag}
                          </Badge>
                        ))}
                        {suggestion.tags.length > 2 && (
                          <Badge variant="outline" className="text-xs">
                            +{suggestion.tags.length - 2}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

"use client";

import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

// The search box of a discovery toolbar (the catalogue and Browse). It shares a row with its
// buttons while it keeps 18rem, enough for its hint; otherwise the buttons move to a second row.
// On a touch screen it matches their 44px height, with the icon centred on it.
export function ToolbarSearch({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
}) {
  return (
    <div className="relative flex-1 basis-72">
      <Search
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-10 pointer-coarse:h-11"
      />
    </div>
  );
}

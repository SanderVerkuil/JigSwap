import * as Popover from "@radix-ui/react-popover";
import { hexToHsva, hsvaToHex, type HsvaColor } from "@uiw/color-convert";
import ShadeSlider from "@uiw/react-color-shade-slider";
import Wheel from "@uiw/react-color-wheel";
import { ChevronDown } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Curated mid-intensity hues that hold up in both themes. Presets are conventional
// starting points, not a constraint — the raw picker below them stays available.
export const DEFAULT_COLOR_PRESETS = [
  "#EF4444", // red
  "#F97316", // orange
  "#F59E0B", // amber
  "#22C55E", // green
  "#14B8A6", // teal
  "#06B6D4", // cyan
  "#3B82F6", // blue
  "#8B5CF6", // violet (brand hue)
  "#EC4899", // pink
  "#64748B", // slate
];

interface ColorPickerProps {
  value?: string;
  onChange?: (color: string) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Swatches shown above the raw picker; pass [] to hide them. */
  presets?: string[];
}

export function ColorPicker({
  value = "#000000",
  onChange,
  className,
  disabled = false,
  placeholder = "Pick a color",
  presets = DEFAULT_COLOR_PRESETS,
}: ColorPickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  // HSVA is the working space while the popover is open: round-tripping through hex
  // collapses hue at black/white, so the wheel would jump if we derived from `value`
  // on every render. Re-seed from `value` each time the popover opens.
  const [hsva, setHsva] = React.useState<HsvaColor>(() => hexToHsva(value));

  const applyHsva = (next: HsvaColor) => {
    setHsva(next);
    onChange?.(hsvaToHex(next));
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) setHsva(hexToHsva(value));
    setIsOpen(nextOpen);
  };

  return (
    <Popover.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={isOpen}
          className={cn(
            "w-full justify-between",
            disabled && "opacity-50 cursor-not-allowed",
            className,
          )}
          disabled={disabled}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded border border-border"
              style={{ backgroundColor: value }}
            />
            <span className="text-sm">{value || placeholder}</span>
          </div>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="bg-popover z-50 flex flex-col gap-2 rounded-lg border p-2 shadow-md"
          align="start"
        >
          {presets.length > 0 && (
            <div className="grid grid-cols-5 gap-1.5">
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-label={preset}
                  onClick={() => {
                    setHsva(hexToHsva(preset));
                    onChange?.(preset);
                  }}
                  className={cn(
                    "size-7 rounded-md border border-border transition-transform hover:scale-110",
                    value.toLowerCase() === preset.toLowerCase() &&
                      "ring-2 ring-ring ring-offset-1 ring-offset-popover",
                  )}
                  style={{ backgroundColor: preset }}
                />
              ))}
            </div>
          )}
          {/* The reference layout: hue/saturation wheel (all hues at once, white
              centre) with a vertical brightness bar beside it. */}
          <div className="flex items-center gap-3">
            <ShadeSlider
              hsva={hsva}
              direction="vertical"
              // ShadeSlider paints its gradient light-top→dark-bottom but Alpha's
              // vertical pointer math assumes the opposite; `reverse` realigns the
              // handle (and keyboard arrows) with the gradient. Verified against
              // @uiw/react-color-alpha's alphaToOffset in 2.10.3.
              reverse
              style={{ height: 180, width: 16 }}
              onChange={(newShade) => applyHsva({ ...hsva, ...newShade })}
            />
            <Wheel
              color={hsva}
              width={180}
              height={180}
              onChange={(color) => applyHsva({ ...hsva, ...color.hsva })}
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

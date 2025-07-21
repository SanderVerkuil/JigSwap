import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";
import * as React from "react";
import { HexColorPicker } from "react-colorful";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ColorPickerProps {
  value?: string;
  onChange?: (color: string) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function ColorPicker({
  value = "#000000",
  onChange,
  className,
  disabled = false,
  placeholder = "Pick a color",
}: ColorPickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
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
        <Popover.Content className="z-50" align="start">
          <HexColorPicker color={value} onChange={onChange} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

"use client";

// A keyboard-operable file picker: a real <button> that opens a visually hidden file input
// through its ref. A <label> around a display:none input can't be focused or tabbed to, so
// pickers built that way are mouse-only. The input is sr-only rather than display:none so the
// programmatic click opens the picker on every browser, and it stays out of the tab order and the
// accessibility tree (the button is the control).
import { Button } from "@/components/ui/button";
import { useRef, type ComponentProps, type RefObject } from "react";

type FilePickButtonProps = Omit<
  ComponentProps<typeof Button>,
  "type" | "asChild" | "onClick" | "onChange"
> & {
  accept?: string;
  multiple?: boolean;
  /** The picked files (never empty). The input is reset, so picking the same file again fires. */
  onFiles: (files: File[]) => void;
  /** Lets a control elsewhere open the same picker: it clicks this input. */
  inputRef?: RefObject<HTMLInputElement | null>;
};

export function FilePickButton({
  accept,
  multiple,
  disabled,
  onFiles,
  inputRef,
  children,
  ...buttonProps
}: FilePickButtonProps) {
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  return (
    <>
      <Button
        {...buttonProps}
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        {children}
      </Button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </>
  );
}

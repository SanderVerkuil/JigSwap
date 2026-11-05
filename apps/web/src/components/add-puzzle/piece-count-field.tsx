// apps/web/src/components/add-puzzle/piece-count-field.tsx
import { Input } from "@/components/ui/input";
import { PIECE_PRESETS } from "./add-puzzle-schema";

// The most pieces the server takes (catalog/domain/piece-count.ts MAX_PIECE_COUNT).
const MAX_PIECE_COUNT = 1_000_000;

export function PieceCountField({
  value,
  onChange,
  id,
}: {
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  id?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        step="1"
        min="1"
        max={MAX_PIECE_COUNT}
        value={value ?? ""}
        placeholder="1000"
        onChange={(e) => {
          if (e.target.value === "") return onChange(undefined);
          const n = Number(e.target.value);
          // A keystroke that makes no piece count is ignored, like a character past a text field's
          // maxLength: one digit too many must not wipe the number already typed.
          if (Number.isInteger(n) && n >= 1 && n <= MAX_PIECE_COUNT)
            onChange(n);
        }}
      />
      <div className="flex flex-wrap gap-1.5">
        {PIECE_PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={[
              "inline-flex items-center justify-center rounded-md border px-2.5 py-1 text-xs tabular-nums cursor-pointer transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11",
              value === n
                ? "bg-jigsaw-primary-tint text-primary-text border-border"
                : "bg-card text-muted-foreground border-border hover:bg-accent",
            ].join(" ")}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

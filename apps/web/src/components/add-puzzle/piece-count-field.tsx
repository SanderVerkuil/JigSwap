// apps/web/src/components/add-puzzle/piece-count-field.tsx
import { Input } from "@/components/ui/input";
import { PIECE_PRESETS } from "./add-puzzle-schema";

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
        value={value ?? ""}
        placeholder="1000"
        onChange={(e) => {
          if (e.target.value === "") return onChange(undefined);
          const n = Number(e.target.value);
          onChange(Number.isInteger(n) && n >= 1 ? n : undefined);
        }}
      />
      <div className="flex flex-wrap gap-1.5">
        {PIECE_PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={[
              "rounded-full border px-2.5 py-1 font-mono text-xs cursor-pointer transition-colors",
              value === n
                ? "bg-jigsaw-primary-tint text-primary border-border"
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

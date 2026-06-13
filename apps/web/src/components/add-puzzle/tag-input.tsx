// apps/web/src/components/add-puzzle/tag-input.tsx
import { X } from "lucide-react";
import { useState } from "react";

export function TagInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const next = [...value];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setDraft("");
  };
  return (
    <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-2">
      {value.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-full bg-jigsaw-primary-tint py-0.5 pl-2.5 pr-1.5 text-xs font-semibold text-primary"
        >
          {t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            onClick={() => onChange(value.filter((x) => x !== t))}
            className="inline-flex cursor-pointer"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        aria-label="Tags"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim()) add(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        placeholder={value.length ? "" : "landscape, ocean, calm…"}
        className="min-w-[120px] flex-1 border-none bg-transparent px-0.5 py-0.5 text-sm text-foreground outline-none"
      />
    </div>
  );
}

// apps/web/src/components/add-puzzle/tag-input.tsx
import { X } from "lucide-react";
import { useId, useState } from "react";
import { useTranslations } from "use-intl";
import { CATALOG_TEXT_LIMITS, MAX_CATALOG_TAGS } from "./catalog-text-limits";

// At most MAX_CATALOG_TAGS tags of at most CATALOG_TEXT_LIMITS.tag characters, the catalogue's
// bounds: a longer tag is shortened, tags past the limit are not added, and a full list takes
// no more input (its tags can still be removed). A full list's input stays focusable (read-only,
// not disabled, so keyboard focus isn't dropped when the last tag is added) and a hint below,
// announced politely and linked to the input, says why.

export function TagInput({
  value,
  onChange,
  placeholder = "landscape, ocean, calm…",
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const t = useTranslations("puzzles");
  const hintId = useId();
  const [draft, setDraft] = useState("");
  const full = value.length >= MAX_CATALOG_TAGS;
  const add = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim().slice(0, CATALOG_TEXT_LIMITS.tag).trim())
      .filter((s) => s.length > 0);
    const next = [...value];
    for (const p of parts) {
      if (next.length < MAX_CATALOG_TAGS && !next.includes(p)) next.push(p);
    }
    onChange(next);
    setDraft("");
  };
  return (
    <>
      <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-2">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-jigsaw-primary-tint py-0.5 pl-2.5 pr-1.5 text-xs font-semibold text-primary-text"
          >
            {/* A long unbroken tag is cut off with an ellipsis so its remove button stays visible. */}
            <span className="truncate" title={tag}>
              {tag}
            </span>
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => onChange(value.filter((x) => x !== tag))}
              className="inline-flex shrink-0 cursor-pointer"
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
          readOnly={full}
          aria-disabled={full || undefined}
          aria-describedby={full ? hintId : undefined}
          placeholder={value.length ? "" : placeholder}
          className="min-w-[120px] flex-1 border-none bg-transparent px-0.5 py-0.5 text-sm text-foreground outline-none"
        />
      </div>
      <p
        id={hintId}
        aria-live="polite"
        className="text-xs text-muted-foreground empty:hidden"
      >
        {full ? t("tagsLimit", { max: MAX_CATALOG_TAGS }) : ""}
      </p>
    </>
  );
}

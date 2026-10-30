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

/**
 * Free-text tags. Pass `id` and point the field's visible <Label htmlFor> at it so the input is named
 * by that label; the built-in aria-label is only the fallback when there is none.
 */
export function TagInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id?: string;
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const t = useTranslations("puzzles");
  const tCommon = useTranslations("common");
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
      <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-2 transition-[color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex min-w-0 max-w-full items-center gap-0.5 rounded-full bg-jigsaw-primary-tint pl-2.5 text-xs font-semibold text-primary-text"
          >
            {/* A long unbroken tag is cut off with an ellipsis so its remove button stays visible. */}
            <span className="truncate" title={tag}>
              {tag}
            </span>
            <button
              type="button"
              aria-label={tCommon("removeTag", { tag })}
              onClick={() => onChange(value.filter((x) => x !== tag))}
              className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          id={id}
          aria-label={id ? undefined : tCommon("tags")}
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
          placeholder={
            value.length ? "" : (placeholder ?? t("tagsPlaceholder"))
          }
          className="min-w-[120px] flex-1 border-none bg-transparent px-0.5 py-0.5 text-base text-foreground outline-none md:text-sm"
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

// apps/web/src/components/add-puzzle/live-preview-card.tsx
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

export interface LivePreviewProps {
  title: string;
  brand: string;
  pieceCount: number | undefined;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  coverColor: string;
  coverPhotoUrl?: string;
  available: boolean;
}

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  expert: "Expert",
};

export function LivePreviewCard(props: LivePreviewProps) {
  const cover = props.coverPhotoUrl
    ? {
        backgroundImage: `url(${props.coverPhotoUrl})`,
        backgroundSize: "cover",
      }
    : {
        background: `linear-gradient(150deg, ${props.coverColor}, color-mix(in oklab, ${props.coverColor}, black 35%))`,
      };
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="relative aspect-square w-full" style={cover}>
        {props.available && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-jigsaw-secondary px-2.5 py-1 text-xs font-semibold text-white">
            <span className="size-1.5 rounded-full bg-white" /> Available
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent p-4">
          <div className="font-semibold text-white">
            {props.title || "Your puzzle title"}
          </div>
          <div className="text-sm text-white/80">{props.brand || "Brand"}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <span className="text-sm">
          <span className="font-semibold">{props.pieceCount ?? 0}</span> pieces
        </span>
        {props.difficulty && (
          <Badge variant="outline">{DIFFICULTY_LABEL[props.difficulty]}</Badge>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
        <Button variant="outline" size="sm" type="button" disabled>
          View
        </Button>
        <Button size="sm" type="button" disabled>
          Add
        </Button>
      </div>
    </div>
  );
}

export function ReadinessChecklist({
  items,
}: {
  items: ReadonlyArray<{ ok: boolean; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-border pt-3">
      {items.map((c) => (
        <div
          key={c.label}
          className={[
            "flex items-center gap-2.5 text-sm",
            c.ok ? "text-foreground" : "text-muted-foreground",
          ].join(" ")}
        >
          <span
            className={[
              "inline-flex size-[18px] items-center justify-center rounded-full",
              c.ok ? "bg-jigsaw-secondary text-white" : "bg-muted",
            ].join(" ")}
          >
            {c.ok && <Check className="size-3" />}
          </span>
          {c.label}
        </div>
      ))}
    </div>
  );
}

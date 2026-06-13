// apps/web/src/components/add-puzzle/add-puzzle-layout.tsx
import type { ReactNode } from "react";

export function AddPuzzleLayout({
  form,
  preview,
}: {
  form: ReactNode;
  preview: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_332px]">
      <div className="flex flex-col gap-8">{form}</div>
      <aside className="flex flex-col gap-3.5 lg:sticky lg:top-2">
        {preview}
      </aside>
    </div>
  );
}

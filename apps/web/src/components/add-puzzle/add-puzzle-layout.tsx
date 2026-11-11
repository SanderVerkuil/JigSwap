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
    <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,1fr)_332px]">
      <div className="flex flex-col gap-8">{form}</div>
      {/* The preview and readiness checklist only fit beside the form, and only from xl: at lg,
          with the sidebar open, the 332px column squeezed the fields narrower than on a tablet.
          Below xl they would land under the submit button, a large card with look-alike buttons, so
          they are left out there: forms recap with AddPuzzleSummary above their submit, and the
          form's own hint next to the submit button says what is still missing. */}
      <aside className="hidden flex-col gap-3.5 xl:sticky xl:top-[calc(var(--app-sticky-top,0px)+0.5rem)] xl:flex">
        {preview}
      </aside>
    </div>
  );
}

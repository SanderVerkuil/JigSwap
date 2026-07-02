"use client";

// Shared empty state for the admin triage queues: a dashed panel with a
// success-toned icon, a bold "all clear" title and a muted per-queue label.

import { CheckCircle, type LucideIcon } from "lucide-react";

export function QueueEmpty({
  icon: Icon = CheckCircle,
  title,
  label,
}: {
  icon?: LucideIcon;
  title: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
      <Icon className="text-jigsaw-success size-8" aria-hidden />
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

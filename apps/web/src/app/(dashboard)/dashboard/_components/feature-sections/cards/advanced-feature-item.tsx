"use client";

import { Badge } from "@/components/ui/badge";
import { LucideIcon } from "lucide-react";

interface AdvancedFeatureItemProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export function AdvancedFeatureItem({
  icon: Icon,
  title,
  description,
}: AdvancedFeatureItemProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
        <Badge variant="secondary" className="text-xs">
          Coming Soon™
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

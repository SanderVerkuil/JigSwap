'use client';

import { Badge } from '@/components/ui/badge';

interface ComingSoonBadgeProps {
  description: string;
}

export function ComingSoonBadge({ description }: ComingSoonBadgeProps) {
  return (
    <div className="flex items-center gap-2">
      <Badge variant="secondary" className="text-xs">
        Coming Soon™
      </Badge>
      <span className="text-xs text-muted-foreground">{description}</span>
    </div>
  );
}

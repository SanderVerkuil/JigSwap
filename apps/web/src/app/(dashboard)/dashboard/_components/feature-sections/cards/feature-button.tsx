'use client';

import { Button } from '@/components/ui/button';
import { LucideIcon } from 'lucide-react';
import Link from 'next/link';

interface FeatureButtonProps {
  href: string;
  icon: LucideIcon;
  label: string;
}

export function FeatureButton({ href, icon: Icon, label }: FeatureButtonProps) {
  return (
    <Link href={href}>
      <Button variant="outline" className="w-full h-12 flex flex-row">
        <Icon className="h-4 w-4" />
        <span className="text-xs">{label}</span>
      </Button>
    </Link>
  );
}

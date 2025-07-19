"use client";

import { Button } from "@/components/ui/button";
import { LucideIcon } from "lucide-react";
import Link from "next/link";

interface ActionButtonProps {
  href: string;
  icon: LucideIcon;
  label: string;
}

export function ActionButton({ href, icon: Icon, label }: ActionButtonProps) {
  return (
    <Link href={href}>
      <Button className="w-full h-20 flex flex-row" variant="outline">
        <Icon className="h-6 w-6" />
        <span>{label}</span>
      </Button>
    </Link>
  );
}

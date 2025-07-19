"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeftRight, Package, PlusCircle, Search } from "lucide-react";
import { ActionButton } from "./cards/action-button";

export function QuickActionsSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
        <CardDescription>Get started with common tasks</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <ActionButton
            href="/puzzles/new"
            icon={PlusCircle}
            label="Add New Puzzle"
          />
          <ActionButton href="/browse" icon={Search} label="Browse Puzzles" />
          <ActionButton
            href="/trades"
            icon={ArrowLeftRight}
            label="View Trades"
          />
          <ActionButton
            href="/my-puzzles"
            icon={Package}
            label="My Collection"
          />
        </div>
      </CardContent>
    </Card>
  );
}

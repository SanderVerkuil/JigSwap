"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BarChart3, BookOpen, Package, Target, TrendingUp } from "lucide-react";
import { ComingSoonBadge } from "./cards/coming-soon-badge";
import { FeatureButton } from "./cards/feature-button";

export function PersonalLibrarySection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Personal Library & Analytics
        </CardTitle>
        <CardDescription>
          Manage your collection and track progress
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FeatureButton
            href="/my-puzzles"
            icon={Package}
            label="My Collection"
          />
          <FeatureButton href="/analytics" icon={BarChart3} label="Analytics" />
          <FeatureButton
            href="/completion-tracking"
            icon={Target}
            label="Track Progress"
          />
          <FeatureButton href="/goals" icon={TrendingUp} label="Goals" />
        </div>
        <ComingSoonBadge description="Advanced analytics and goal tracking" />
      </CardContent>
    </Card>
  );
}

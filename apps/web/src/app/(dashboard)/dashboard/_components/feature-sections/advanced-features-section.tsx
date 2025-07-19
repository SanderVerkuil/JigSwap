"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Award, Bell, Settings, Shield } from "lucide-react";
import { AdvancedFeatureItem } from "./cards/advanced-feature-item";

export function AdvancedFeaturesSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Advanced Features
        </CardTitle>
        <CardDescription>
          Enhanced functionality for power users
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <AdvancedFeatureItem
            icon={Shield}
            title="Friend Circles"
            description="Create private groups to share puzzles exclusively with trusted friends"
          />
          <AdvancedFeatureItem
            icon={Award}
            title="Smart Recommendations"
            description="Get personalized puzzle recommendations based on your preferences"
          />
          <AdvancedFeatureItem
            icon={Bell}
            title="Advanced Notifications"
            description="Customizable alerts for trades, goals, and community activity"
          />
        </div>
      </CardContent>
    </Card>
  );
}

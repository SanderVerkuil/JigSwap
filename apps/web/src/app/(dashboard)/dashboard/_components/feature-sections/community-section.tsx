'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Users, Globe, Star, MessageSquare } from 'lucide-react';
import { FeatureButton } from './cards/feature-button';
import { ComingSoonBadge } from './cards/coming-soon-badge';

export function CommunitySection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Community & Social
        </CardTitle>
        <CardDescription>Connect with other puzzle enthusiasts</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FeatureButton href="/community" icon={Globe} label="Community" />
          <FeatureButton href="/profiles" icon={Users} label="Profiles" />
          <FeatureButton href="/reviews" icon={Star} label="Reviews" />
          <FeatureButton
            href="/messages"
            icon={MessageSquare}
            label="Messages"
          />
        </div>
        <ComingSoonBadge description="Community features and social discovery" />
      </CardContent>
    </Card>
  );
}

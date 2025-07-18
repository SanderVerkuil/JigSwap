'use client';

import { Puzzle, Users, Recycle, BarChart3 } from 'lucide-react';

export function CoreFeatures() {
  return (
    <section className="py-20 px-4 bg-muted/50">
      <div className="container mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">
          Complete Puzzle Management Platform
        </h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-jigsaw-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Puzzle className="h-8 w-8 text-jigsaw-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Personal Library</h3>
            <p className="text-muted-foreground text-sm">
              Track your collection, completion history, and personal analytics
              with detailed statistics and progress tracking.
            </p>
          </div>
          <div className="text-center">
            <div className="w-16 h-16 bg-jigsaw-secondary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Recycle className="h-8 w-8 text-jigsaw-secondary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Smart Exchange</h3>
            <p className="text-muted-foreground text-sm">
              Lend, swap, or trade puzzles while preserving your completion
              history and tracking ownership chains.
            </p>
          </div>
          <div className="text-center">
            <div className="w-16 h-16 bg-jigsaw-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="h-8 w-8 text-jigsaw-success" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Community</h3>
            <p className="text-muted-foreground text-sm">
              Connect with fellow enthusiasts, share reviews, and discover new
              puzzles through social features.
            </p>
          </div>
          <div className="text-center">
            <div className="w-16 h-16 bg-jigsaw-warning/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <BarChart3 className="h-8 w-8 text-jigsaw-warning" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Analytics</h3>
            <p className="text-muted-foreground text-sm">
              Gain insights into your solving patterns, set goals, and compare
              with community trends.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

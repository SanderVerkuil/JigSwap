'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { Authenticated, Unauthenticated } from 'convex/react';

export function CallToAction() {
  return (
    <section className="py-20 px-4 bg-jigsaw-primary text-white">
      <div className="container mx-auto text-center">
        <h2 className="text-3xl font-bold mb-4">
          Ready to Transform Your Puzzle Experience?
        </h2>
        <p className="text-xl mb-8 opacity-90">
          Join thousands of puzzle enthusiasts who are already managing their
          collections, trading puzzles, and connecting with the community on
          JigSwap
        </p>
        <Unauthenticated>
          <Link href="/sign-up">
            <Button size="lg" variant="secondary">
              Start Your Puzzle Journey
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </Unauthenticated>
        <Authenticated>
          <Link href="/dashboard">
            <Button size="lg" variant="secondary">
              Go to Dashboard
            </Button>
          </Link>
        </Authenticated>
      </div>
    </section>
  );
}

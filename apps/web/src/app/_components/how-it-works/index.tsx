'use client';

export function HowItWorks() {
  return (
    <section className="py-20 px-4 bg-muted/50">
      <div className="container mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">
          How JigSwap Works
        </h2>
        <div className="grid md:grid-cols-4 gap-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-jigsaw-primary text-white rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
              1
            </div>
            <h3 className="text-lg font-semibold mb-2">Build Your Library</h3>
            <p className="text-muted-foreground text-sm">
              Add your puzzles to your personal library with detailed
              information, photos, and completion tracking.
            </p>
          </div>
          <div className="text-center">
            <div className="w-12 h-12 bg-jigsaw-primary text-white rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
              2
            </div>
            <h3 className="text-lg font-semibold mb-2">Discover & Connect</h3>
            <p className="text-muted-foreground text-sm">
              Browse puzzles from other enthusiasts, read reviews, and connect
              with the community.
            </p>
          </div>
          <div className="text-center">
            <div className="w-12 h-12 bg-jigsaw-primary text-white rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
              3
            </div>
            <h3 className="text-lg font-semibold mb-2">Exchange & Trade</h3>
            <p className="text-muted-foreground text-sm">
              Initiate exchanges, negotiate terms, and track the entire process
              while preserving your history.
            </p>
          </div>
          <div className="text-center">
            <div className="w-12 h-12 bg-jigsaw-primary text-white rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
              4
            </div>
            <h3 className="text-lg font-semibold mb-2">Analyze & Improve</h3>
            <p className="text-muted-foreground text-sm">
              Track your progress, set goals, and gain insights from
              comprehensive analytics and community data.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

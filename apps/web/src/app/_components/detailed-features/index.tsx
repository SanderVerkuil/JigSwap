'use client';

export function DetailedFeatures() {
  return (
    <section className="py-20 px-4">
      <div className="container mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">
          Powerful Features for Puzzle Enthusiasts
        </h2>

        {/* Personal Library Features */}
        <div className="mb-16">
          <h3 className="text-2xl font-semibold mb-6 text-center">
            📚 Personal Puzzle Library
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">Collection Management</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• Add puzzles with detailed information</li>
                <li>• Organize with custom categories & tags</li>
                <li>• Set visibility levels (private to tradeable)</li>
                <li>• Search and filter your collection</li>
              </ul>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">Completion Tracking</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• Record start and completion times</li>
                <li>• Rate puzzles and add personal notes</li>
                <li>• Upload photos of completed puzzles</li>
                <li>• Track multiple completions</li>
              </ul>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">Personal Analytics</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• View completion statistics</li>
                <li>• Analyze solving time trends</li>
                <li>• Set and track personal goals</li>
                <li>• Export your data</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Exchange System Features */}
        <div className="mb-16">
          <h3 className="text-2xl font-semibold mb-6 text-center">
            🔄 Advanced Exchange System
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">Multiple Exchange Types</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• Lending with return agreements</li>
                <li>• Permanent swaps between users</li>
                <li>• Direct sales and auctions</li>
                <li>• Negotiable terms and conditions</li>
              </ul>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">History Preservation</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• Keep your completion records</li>
                <li>• Complete ownership tracking</li>
                <li>• Chain of custody for all puzzles</li>
                <li>• Condition tracking through exchanges</li>
              </ul>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">Exchange Management</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• Real-time messaging during exchanges</li>
                <li>• Photo documentation of condition</li>
                <li>• Dispute resolution system</li>
                <li>• Exchange ratings and feedback</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Community Features */}
        <div className="mb-16">
          <h3 className="text-2xl font-semibold mb-6 text-center">
            👥 Community & Social Features
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">User Profiles</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• Showcase your collection</li>
                <li>• Display achievements and statistics</li>
                <li>• Follow other enthusiasts</li>
                <li>• Location-based discovery</li>
              </ul>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">Reviews & Ratings</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• Write detailed puzzle reviews</li>
                <li>• Rate on multiple criteria</li>
                <li>• Vote on helpful reviews</li>
                <li>• See community opinions</li>
              </ul>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">Social Discovery</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• Find users by location</li>
                <li>• Discover trending puzzles</li>
                <li>• Community discussions</li>
                <li>• Smart recommendations</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Advanced Features */}
        <div className="mb-16">
          <h3 className="text-2xl font-semibold mb-6 text-center">
            ⚡ Advanced Features
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">Condition Tracking</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• Document puzzle condition</li>
                <li>• Track changes over time</li>
                <li>• Photo documentation</li>
                <li>• Condition-based filtering</li>
              </ul>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">Smart Recommendations</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• AI-powered puzzle suggestions</li>
                <li>• Find similar users</li>
                <li>• Optimal exchange opportunities</li>
                <li>• Collaborative filtering</li>
              </ul>
            </div>
            <div className="bg-card p-6 rounded-lg border">
              <h4 className="font-semibold mb-3">Notification System</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• Real-time exchange alerts</li>
                <li>• Goal achievement notifications</li>
                <li>• Community activity updates</li>
                <li>• Customizable preferences</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

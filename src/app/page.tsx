import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Puzzle, Users, Recycle, Star, ArrowRight } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-2xl">🧩</span>
            <span className="text-xl font-bold text-jigsaw-primary">JigSwap</span>
          </div>
          <div className="flex items-center space-x-4">
            <ThemeToggle />
            <Link href="/sign-in">
              <Button variant="ghost">Sign In</Button>
            </Link>
            <Link href="/sign-up">
              <Button variant="jigsaw">Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto text-center">
          <h1 className="text-4xl md:text-6xl font-bold mb-6">
            Trade Jigsaw Puzzles with{" "}
            <span className="text-jigsaw-primary">Fellow Enthusiasts</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Connect with puzzle lovers worldwide. Trade your completed puzzles, 
            discover new challenges, and make the hobby more sustainable.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/sign-up">
              <Button size="lg" variant="jigsaw" className="w-full sm:w-auto">
                Start Trading
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/browse">
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                Browse Puzzles
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4 bg-muted/50">
        <div className="container mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            Why Choose JigSwap?
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-jigsaw-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Puzzle className="h-8 w-8 text-jigsaw-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Vast Collection</h3>
              <p className="text-muted-foreground">
                Access thousands of puzzles from fellow enthusiasts. Find rare pieces 
                and discover new favorites.
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-jigsaw-secondary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="h-8 w-8 text-jigsaw-secondary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Community Driven</h3>
              <p className="text-muted-foreground">
                Join a passionate community of puzzle lovers. Share experiences 
                and build lasting connections.
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-jigsaw-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Recycle className="h-8 w-8 text-jigsaw-success" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Sustainable</h3>
              <p className="text-muted-foreground">
                Reduce waste by giving puzzles a second life. Make your hobby 
                more environmentally friendly.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            How It Works
          </h2>
          <div className="grid md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="w-12 h-12 bg-jigsaw-primary text-white rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
                1
              </div>
              <h3 className="text-lg font-semibold mb-2">List Your Puzzles</h3>
              <p className="text-muted-foreground text-sm">
                Upload photos and details of puzzles you've completed and want to trade.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-jigsaw-primary text-white rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
                2
              </div>
              <h3 className="text-lg font-semibold mb-2">Browse & Discover</h3>
              <p className="text-muted-foreground text-sm">
                Explore puzzles from other users and find ones you'd love to try.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-jigsaw-primary text-white rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
                3
              </div>
              <h3 className="text-lg font-semibold mb-2">Make a Trade</h3>
              <p className="text-muted-foreground text-sm">
                Send trade requests and negotiate exchanges with other users.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-jigsaw-primary text-white rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">
                4
              </div>
              <h3 className="text-lg font-semibold mb-2">Enjoy & Review</h3>
              <p className="text-muted-foreground text-sm">
                Complete your new puzzle and leave reviews to build trust in the community.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 bg-jigsaw-primary text-white">
        <div className="container mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">
            Ready to Start Trading?
          </h2>
          <p className="text-xl mb-8 opacity-90">
            Join thousands of puzzle enthusiasts already trading on JigSwap
          </p>
          <Link href="/sign-up">
            <Button size="lg" variant="secondary">
              Create Your Account
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 px-4">
        <div className="container mx-auto text-center text-muted-foreground">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <span className="text-xl">🧩</span>
            <span className="font-semibold">JigSwap</span>
          </div>
          <p className="text-sm">
            Making jigsaw puzzle trading accessible and sustainable for everyone.
          </p>
          <div className="mt-4 flex justify-center space-x-6 text-sm">
            <Link href="/about" className="hover:text-foreground">About</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/contact" className="hover:text-foreground">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

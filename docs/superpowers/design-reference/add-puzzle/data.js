// JigSwap application data — expanded, deduplicated information architecture.
// One logical home per surface, grouped Overview / My Library / Community.
window.JIGSWAP = (function () {
  const user = { name: "Mara Ito", username: "mara", email: "mara.ito@posteo.nl", location: "Utrecht, NL", since: "2025", rating: 4.9, reviews: 11 };

  // ---- Navigation: grouped + deduplicated --------------------------------
  // Replaces the flat 14-item list (Puzzles / My Puzzles / Borrowed /
  // Collections / Completions … ) with three tidy clusters.
  const groups = [
    {
      key: "overview", label: null,
      items: [
        { id: "dashboard", title: "Dashboard", icon: "layout-dashboard", desc: "Your puzzle world at a glance" },
      ],
    },
    {
      key: "library", label: "My Library", icon: "book-open", blurb: "Everything you own & track",
      items: [
        { id: "puzzles", title: "My Puzzles", icon: "puzzle", desc: "Copies you own & their status", count: 24 },
        { id: "collections", title: "Collections", icon: "folder", desc: "Curated sets & shelves", count: 6 },
        { id: "completions", title: "Completions", icon: "circle-check", desc: "Your finished-puzzle log", count: 37 },
        { id: "goals", title: "Goals", icon: "target", desc: "Personal targets for the year", count: 4 },
        { id: "insights", title: "Insights", icon: "bar-chart-3", desc: "Stats & trends" },
      ],
    },
    {
      key: "community", label: "Community", icon: "users", blurb: "Discover, swap & connect",
      items: [
        { id: "browse", title: "Browse Puzzles", icon: "search", desc: "Discover from the community" },
        { id: "circles", title: "Circles", icon: "users", desc: "Friend & family swap groups", count: 3 },
        { id: "exchanges", title: "Exchanges", icon: "arrow-left-right", desc: "Swaps, lends & trades", badge: 3 },
        { id: "messages", title: "Messages", icon: "message-square", desc: "Conversations", badge: 2 },
        { id: "people", title: "People", icon: "globe", desc: "Members & profiles" },
      ],
    },
  ];

  const SECTION_OF = {};
  groups.forEach((g) => g.items.forEach((it) => { SECTION_OF[it.id] = g; }));

  const stats = [
    { label: "Puzzles Owned", value: 24, sub: "12 available for trade", icon: "package", to: "puzzles" },
    { label: "Exchanges Completed", value: 8, sub: "Across 6 members", icon: "arrow-left-right", to: "exchanges" },
    { label: "Average Rating", value: "4.9", sub: "From 11 reviews", icon: "star", to: "people" },
    { label: "Active Exchanges", value: 3, sub: "Ongoing right now", icon: "message-square", to: "exchanges" },
  ];

  const V = "var(--jig-violet-400)", G = "var(--swap-green-400)", P = "var(--piece-pink-400)";
  const puzzles = [
    { id: 1, title: "Starry Night", brand: "Ravensburger", pieceCount: 1000, difficulty: "hard", condition: "Excellent", color: "var(--jig-violet-500)", status: ["For Trade"], available: true, tags: ["art", "classic"] },
    { id: 2, title: "Wildflower Meadow", brand: "Clementoni", pieceCount: 500, difficulty: "easy", condition: "Good", color: "var(--swap-green-400)", status: ["For Trade", "For Lend"], available: true, tags: ["nature"] },
    { id: 3, title: "Sunset Bay", brand: "Gibsons", pieceCount: 1500, difficulty: "expert", condition: "Good", color: "var(--piece-pink-400)", status: ["In Progress"], available: false, tags: ["landscape"] },
    { id: 4, title: "Autumn Maple Lane", brand: "Schmidt", pieceCount: 750, difficulty: "medium", condition: "Excellent", color: "var(--amber-400)", status: ["For Trade", "For Sale"], available: true, tags: ["seasonal"] },
    { id: 5, title: "Tokyo at Night", brand: "Ravensburger", pieceCount: 2000, difficulty: "expert", condition: "Fair", color: "var(--jig-violet-600)", status: ["Completed"], available: false, tags: ["city"] },
    { id: 6, title: "Coral Reef", brand: "Educa", pieceCount: 1000, difficulty: "medium", condition: "Good", color: "var(--swap-green-600)", status: ["For Trade"], available: true, tags: ["ocean"] },
    { id: 7, title: "Lavender Fields", brand: "Heye", pieceCount: 500, difficulty: "easy", condition: "Excellent", color: "var(--jig-violet-300)", status: ["For Lend"], available: true, tags: ["calm"] },
    { id: 8, title: "Hot Air Balloons", brand: "Clementoni", pieceCount: 1500, difficulty: "hard", condition: "Good", color: "var(--piece-pink-500)", status: ["For Trade"], available: true, tags: ["sky"] },
  ];

  // Puzzle plank — the signature shelf motif
  const shelf = [
    { title: "Sand Sculptures", cover: "assets/covers/zandsculpturen.jpg", c1: "#34507a", c2: "#1e3253", width: 168 },
    { title: "Meadow", series: "Wildflowers", pieceCount: 500, c1: "var(--swap-green-300)", c2: "var(--swap-green-600)", height: 134 },
    { title: "Sunset Bay", series: "Coastline", pieceCount: 1500, c1: "var(--piece-pink-400)", c2: "var(--piece-pink-500)", height: 156 },
    { title: "Autumn", series: "Maple Lane", pieceCount: 750, c1: "var(--amber-400)", c2: "var(--orange-500)", height: 128 },
    { title: "Coral", series: "Reef", pieceCount: 1000, c1: "var(--swap-green-400)", c2: "var(--swap-green-700)", height: 142 },
  ];

  const collections = [
    { id: 1, name: "Coastal Calm", blurb: "Beaches, bays & big skies", icon: "waves", visibility: "Public", updated: "2 days ago", note: "My happy-place puzzles — soft palettes and water everywhere. Great for unwinding on a slow Sunday.", puzzleIds: [3, 6, 2, 7], c1: "var(--swap-green-300)", c2: "var(--swap-green-600)" },
    { id: 2, name: "City Lights", blurb: "Skylines after dark", icon: "building-2", visibility: "Public", updated: "1 week ago", note: "Neon, reflections and a lot of tiny windows. Not for the faint-hearted.", puzzleIds: [5, 1, 8], c1: "var(--jig-violet-400)", c2: "var(--jig-violet-700)" },
    { id: 3, name: "For the Kids", blurb: "Easy & cheerful, 100–300pc", icon: "baby", visibility: "Private", updated: "3 weeks ago", note: "Quick, bright and forgiving — what we reach for with the little ones on rainy afternoons.", puzzleIds: [2, 7], c1: "var(--amber-400)", c2: "var(--orange-500)" },
    { id: 4, name: "Fine Art", blurb: "Masters & museums", icon: "palette", visibility: "Public", updated: "5 days ago", note: "Gallery classics. Slow, detailed, deeply satisfying once the frame comes together.", puzzleIds: [1, 5], c1: "var(--piece-pink-400)", c2: "var(--piece-pink-500)" },
    { id: 5, name: "Up for Trade", blurb: "Ready to find new homes", icon: "arrow-left-right", visibility: "Public", updated: "Today", note: "Everything here is available right now — send a swap if something catches your eye!", puzzleIds: [1, 2, 4, 6, 8], c1: "var(--jig-violet-300)", c2: "var(--jig-violet-500)" },
    { id: 6, name: "Rainy-Day Marathon", blurb: "1500pc+ challenges", icon: "cloud-rain", visibility: "Private", updated: "2 weeks ago", note: "The big ones. Clear the table, brew some tea, and don't expect to finish in a day.", puzzleIds: [3, 5, 8], c1: "var(--swap-green-400)", c2: "var(--swap-green-700)" },
  ];
  collections.forEach((c) => { c.count = c.puzzleIds.length; });

  const circles = [
    { id: 1, name: "Ito Family", members: 6, role: "Owner", shared: 18, blurb: "Sunday-afternoon swaps with the family", color: "var(--jig-violet-500)", avatars: ["Mara Ito", "Kenji Ito", "Yumi Ito", "Hana Ito"] },
    { id: 2, name: "Utrecht Puzzlers", members: 23, role: "Member", shared: 64, blurb: "Local hobby group, monthly meetups", color: "var(--swap-green-500)", avatars: ["Tomas Vega", "Lena Fischer", "Priya Shah", "Bram de Vries"] },
    { id: 3, name: "1000+ Club", members: 11, role: "Moderator", shared: 31, blurb: "For people who like a real challenge", color: "var(--piece-pink-500)", avatars: ["Priya Shah", "Noa Jansen", "Mara Ito"] },
  ];

  const completions = [
    { id: 1, title: "Tokyo at Night", pieceCount: 2000, days: 9, when: "May 2026", rating: 5, color: "var(--jig-violet-600)" },
    { id: 2, title: "Coral Reef", pieceCount: 1000, days: 3, when: "Apr 2026", rating: 4, color: "var(--swap-green-600)" },
    { id: 3, title: "Hot Air Balloons", pieceCount: 1500, days: 6, when: "Mar 2026", rating: 5, color: "var(--piece-pink-500)" },
    { id: 4, title: "Wildflower Meadow", pieceCount: 500, days: 2, when: "Mar 2026", rating: 4, color: "var(--swap-green-400)" },
    { id: 5, title: "Autumn Maple Lane", pieceCount: 750, days: 4, when: "Feb 2026", rating: 3, color: "var(--amber-400)" },
  ];

  const goals = [
    { id: 1, title: "Complete 50 puzzles in 2026", current: 37, target: 50, unit: "done", icon: "circle-check", deadline: "Dec 31" },
    { id: 2, title: "Try 5 expert-level (2000pc+)", current: 3, target: 5, unit: "tried", icon: "target", deadline: "Dec 31" },
    { id: 3, title: "Swap 20 puzzles forward", current: 12, target: 20, unit: "swapped", icon: "arrow-left-right", deadline: "Dec 31" },
    { id: 4, title: "Grow the Ito Family circle to 10", current: 6, target: 10, unit: "members", icon: "users", deadline: "Sep 30" },
  ];

  const exchanges = [
    { id: 1, kind: "Swap", dir: "Incoming", who: "Tomas Vega", mine: "Starry Night", theirs: "Mountain Dawn", status: "Pending", when: "2h ago", color: "var(--jig-violet-500)" },
    { id: 2, kind: "Lend", dir: "Outgoing", who: "Lena Fischer", mine: "Lavender Fields", theirs: null, status: "Accepted", when: "1d ago", color: "var(--jig-violet-300)" },
    { id: 3, kind: "Swap", dir: "Outgoing", who: "Priya Shah", mine: "Coral Reef", theirs: "Desert Bloom", status: "In Transit", when: "2d ago", color: "var(--swap-green-600)" },
    { id: 4, kind: "Sale", dir: "Incoming", who: "Bram de Vries", mine: "Autumn Maple Lane", theirs: null, status: "Completed", when: "1w ago", color: "var(--amber-400)" },
  ];

  const messages = [
    { id: 1, who: "Tomas Vega", last: "Sounds great — I'll post Starry Night tomorrow!", when: "2h", unread: 1 },
    { id: 2, who: "Priya Shah", last: "Did Coral Reef arrive okay?", when: "1d", unread: 1 },
    { id: 3, who: "Lena Fischer", last: "Thanks for the lend 💛", when: "3d", unread: 0 },
    { id: 4, who: "Utrecht Puzzlers", last: "Bram: Anyone up for a 2000pc this weekend?", when: "4d", unread: 0 },
  ];

  const people = [
    { id: 1, name: "Tomas Vega", location: "Amsterdam, NL", owned: 41, rating: 4.8, swaps: 22 },
    { id: 2, name: "Priya Shah", location: "Rotterdam, NL", owned: 67, rating: 5.0, swaps: 39 },
    { id: 3, name: "Lena Fischer", location: "Utrecht, NL", owned: 18, rating: 4.6, swaps: 9 },
    { id: 4, name: "Bram de Vries", location: "Utrecht, NL", owned: 33, rating: 4.9, swaps: 27 },
    { id: 5, name: "Noa Jansen", location: "Den Haag, NL", owned: 52, rating: 4.7, swaps: 18 },
    { id: 6, name: "Kenji Ito", location: "Utrecht, NL", owned: 12, rating: 5.0, swaps: 6 },
  ];

  const activity = [
    { who: "Tomas Vega", action: "wants to swap for", what: "Starry Night", when: "2h ago", icon: "arrow-left-right" },
    { who: "Priya Shah", action: "completed an exchange of", what: "Coral Reef", when: "1d ago", icon: "circle-check" },
    { who: "Lena Fischer", action: "reviewed your", what: "Wildflower Meadow", when: "3d ago", icon: "star" },
    { who: "Ito Family", action: "added 3 puzzles to", what: "the shared shelf", when: "4d ago", icon: "users" },
  ];

  const notifications = [
    { id: 1, icon: "arrow-left-right", title: "New swap request", body: "Tomas Vega wants your Starry Night", when: "2h ago", unread: true, to: "exchanges" },
    { id: 2, icon: "message-square", title: "New message", body: "Priya Shah: Did Coral Reef arrive okay?", when: "1d ago", unread: true, to: "messages" },
    { id: 3, icon: "star", title: "You got a 5★ review", body: "Lena Fischer reviewed Wildflower Meadow", when: "3d ago", unread: false, to: "people" },
    { id: 4, icon: "target", title: "Goal progress", body: "You're 74% to your 50-puzzle goal", when: "5d ago", unread: false, to: "goals" },
  ];

  return { user, groups, SECTION_OF, stats, puzzles, shelf, collections, circles, completions, goals, exchanges, messages, people, activity, notifications };
})();

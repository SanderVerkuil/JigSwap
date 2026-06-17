# JigSwap User Guide

Welcome to **JigSwap** — your personal jigsaw puzzle library and exchange platform. JigSwap lets you catalog the puzzles you own, track every puzzle you solve, set goals, and lend, swap, or trade puzzles with friends, family, and the wider puzzle community.

This guide is written for puzzle owners and swappers. It walks you through everything you can do, step by step, organized by what you're trying to accomplish. No technical knowledge required.

---

## Table of Contents

1. [Getting Started — Account & Sign In](#1-getting-started--account--sign-in)
2. [Finding Your Way Around](#2-finding-your-way-around)
3. [Your Dashboard (Morning Briefing)](#3-your-dashboard-morning-briefing)
4. [Managing Your Puzzle Library](#4-managing-your-puzzle-library)
5. [Adding & Importing Puzzles](#5-adding--importing-puzzles)
6. [Collections — Organizing Your Shelves](#6-collections--organizing-your-shelves)
7. [Recording Completions — Your Solving History](#7-recording-completions--your-solving-history)
8. [Goals](#8-goals)
9. [Insights & Stats](#9-insights--stats)
10. [Discovering Puzzles — Browse & Catalogue](#10-discovering-puzzles--browse--catalogue)
11. [The Exchange System — Lend, Swap & Sell](#11-the-exchange-system--lend-swap--sell)
12. [Visibility & Sharing Controls](#12-visibility--sharing-controls)
13. [Friend Circles](#13-friend-circles)
14. [Social & Community Features](#14-social--community-features)
15. [Your Profile & the 3D Shelf](#15-your-profile--the-3d-shelf)
16. [Reputation & Reviews](#16-reputation--reviews)
17. [Notifications](#17-notifications)
18. [Language Settings (English / Dutch)](#18-language-settings-english--dutch)
19. [Quick Search (Command Palette)](#19-quick-search-command-palette)
20. [FAQ & Troubleshooting](#20-faq--troubleshooting)

---

## 1. Getting Started — Account & Sign In

JigSwap uses a secure sign-in system (powered by Clerk). You'll need an account to use the personal library, exchange, and community features.

### Create an account

1. Visit the JigSwap landing page.
2. Click **Sign Up**.
3. Follow the prompts to register (email/password or any sign-in option offered).
4. Once registered, you'll be taken into the app's **Dashboard**.

### Sign in

1. Click **Sign In**.
2. Enter your credentials.
3. You'll land on your personal dashboard.

> **Tip:** If you try to open any private page (your library, trades, profile, etc.) while signed out, JigSwap automatically sends you to the sign-in screen and brings you back to where you were headed after you log in.

### Public pages (no account needed)

Anyone can read the **landing page**, plus **About**, **Features**, **How It Works**, **Contact**, **Privacy Policy**, and **Terms** without signing in.

---

## 2. Finding Your Way Around

Once signed in, JigSwap presents a **dashboard** with a few consistent navigation pieces:

- **On desktop:** a top bar (with a search pill) and a grouped sidebar on the left holding links to all your areas (Library, Community, etc.). Your content appears in a card in the middle.
- **On mobile (phones/small screens):** a slim top bar plus a **bottom tab bar**. A center **quick-action button** opens a sheet with common actions.

Most pages also show a **primary action button** (for example, _Add Puzzle_) and any relevant counts in the page header.

---

## 3. Your Dashboard (Morning Briefing)

**Where:** the home screen after sign-in (`/dashboard`).

Your dashboard is a personal briefing that summarizes your puzzle life at a glance:

- A **headline sentence** summarizing your active exchanges and goal progress.
- A **pending-request banner** if someone has sent you an incoming exchange request that needs a response.
- **Quick-action chips**: _Add Puzzle_, _Browse_, and _Log Completion_.
- A **3D shelf** ("plank") showing your real puzzle copies as physical objects you can look at.
- **Live stats**: how many puzzles you own, trades completed, your average rating, and active exchanges.
- A **pulse section**: exchanges in motion, goal progress, and your latest activity.
- A **fresh-puzzles scroller** to discover newly added community puzzles.

---

## 4. Managing Your Puzzle Library

Your library is the set of physical puzzle **copies** you personally own. (A "copy" is one physical puzzle you own — the platform tracks each copy separately so your history stays with you.)

**Where:** **My Puzzles** (`/my-puzzles`).

### View your puzzles

1. Open **My Puzzles** from the sidebar or tab bar.
2. Switch between **grid** and **list** layouts.
3. Use the **status filter pills** to narrow what you see:
   - **All**
   - **Available**
   - **For Trade**
   - **For Lend**
   - **In Progress**
   - **Completed**

Each puzzle card shows its loan status (who currently has it, if lent out) and gives you quick actions.

### Actions on each puzzle

From a puzzle card you can:

- **View** — open the full copy detail page.
- **Edit** — change the copy's details.
- **Delete** — remove the copy from your library (with confirmation).
- **Log Solve** — record that you've completed (or started) the puzzle.
- **Recall** — if a puzzle is currently lent out, recall it to get it back.

### The copy detail page

**Where:** click **View** on a puzzle, or go to `/my-puzzles/<id>`.

The detail page is the rich record of a single owned copy. It includes:

- A **hero image** with the availability badge and condition/difficulty chips.
- **Acquisition details** (how/when you got it) and your private notes.
- A **stats strip**: times completed, fastest finish, times lent out, and average rating.
- A **photo strip** with a lightbox. As the owner you can upload photos, set a cover image, and leave per-photo comments.
- A two-column **history**: your completion timeline (with ratings), lending history (with status pills), and swap/transfer history.
- A **community rating breakdown** and a comment area.

**Owner actions** on this page include toggling _for-trade_ / _for-lend_, logging a completion, and editing.
**Visitors** (other members) see a public version with _Request Swap_ and _Message_ actions instead.

---

## 5. Adding & Importing Puzzles

**Where:** **My Puzzles → Add Puzzle** (`/my-puzzles/add`).

Adding a puzzle is a two-step flow:

### Step 1 — Choose or search

1. Click **Add Puzzle**.
2. You'll see a chooser page. It lists:
   - Your own submissions that aren't approved yet (at the top).
   - The full **approved catalogue**, with infinite scroll and a free-text search box.
3. If your puzzle already exists in the catalogue, select it to add a copy of it to your library. If it's new, continue to create it.

### Step 2 — Create or copy

You'll land on the creation/copy form (`/my-puzzles/add/new`).

**Import from a store URL (fastest way):**

1. Find the **import zone** at the top of the form.
2. Paste a puzzle's web address from a retailer.
3. JigSwap fetches the puzzle details and auto-fills the form fields for you.
4. If the puzzle already exists in the catalogue, you'll see a **match banner** offering to use the existing entry instead of creating a duplicate.

**Fill in the details manually (or adjust the imported ones):**

- **Title**, **brand**, **piece count**, **difficulty**, **condition**.
- **Availability chips**: mark it _for trade_, _for lend_, and/or _for sale_.
- A **cover** — pick a color swatch, or upload/scrape a photo.
- **Tags** and **notes**.
- **Advanced fields** (collapsible): EAN, UPC, model number, artist, series, shape, dimensions.

A **live preview card** and a **readiness checklist** sit alongside the form so you can see how your puzzle will look.

> **Adding a copy of an existing puzzle:** When you add from the catalogue (copy mode), the puzzle's catalogue definition is locked read-only, and you only fill in the copy-specific fields (your condition, availability, notes, photos, etc.).

### Contributing a brand-new puzzle to the catalogue

If a puzzle isn't in the catalogue yet, you can contribute its definition for everyone. Use **Puzzles → Add** (`/puzzles/add`). This uses the same form (without the copy-specific fields) and sends your submission to the **moderation queue** for an admin to approve.

---

## 6. Collections — Organizing Your Shelves

Collections are named shelves you create to organize your copies.

**Where:** **Collections** (`/collections`).

### Create a collection

1. Open **Collections**.
2. Click to create a new collection.
3. Set:
   - A **name**.
   - An **emoji icon**.
   - A **color**.
   - A **description**.
   - **Visibility** — public or private.
4. Save.

### Add puzzles to a collection

1. Open a collection tile to see its detail.
2. Use **Add puzzles** (`/collections/<id>/add-puzzles`) to attach copies from your library.

Each collection tile shows its puzzle count and whether it's the default.

---

## 7. Recording Completions — Your Solving History

JigSwap keeps a full **solve log** of every puzzle you've worked on — even after you trade the puzzle away, your completion records stay with you.

**Where:** **Completions** (`/completions`).

### Log a completion

1. Go to **My Puzzles**.
2. On the copy you solved, click **Log Solve**.
3. In the dialog, record your solve. A completion can be:
   - **Started** (in-progress) and finished later, or
   - **Recorded** after the fact (already finished).
4. Add **start and end dates**, your **solve time**, optional **notes**, and (if you wish) a **review** with a 1–5 star rating.

> You can attach up to **5 photos** per completion, and edits are allowed within a **24-hour** window after completing.

### The Completions page

The Completions page shows all your solve records, newest first, with a three-stat summary at the top: **total finished**, **pieces placed**, and **finishes this year**.

Each row shows the title, a status badge, a piece/days line, optional notes and review quote, a star rating, and the finish date. Per-row actions:

- **Finish** — for an in-progress solve.
- **Add/Edit Review** — set or change your star rating and review text.
- **Edit** — adjust date range, time, and notes.

---

## 8. Goals

Set personal challenges and track them automatically against your solve log.

**Where:** **Goals** (`/goals`).

### Create a goal

1. Open **Goals**.
2. Create a new goal with:
   - A **title** and **description**.
   - A **target completion count**.
   - An optional **due date**.
3. Save.

Each active goal shows a **progress bar**, a percentage, your current/target count, and a **trophy badge** once achieved. Progress updates automatically as you log completions — you don't have to update goals manually.

---

## 9. Insights & Stats

**Where:** **Insights** (`/insights`).

Your personal analytics dashboard shows:

- Four **stat cards**: total puzzles, completions, trades, and average rating.
- A **completion trends** line chart (over the past 12 months).
- A **trade activity** chart.
- A **collection breakdown** chart (by piece count, brand, difficulty, condition).
- A **data export** button to download your personal data.

---

## 10. Discovering Puzzles — Browse & Catalogue

### Browse community puzzles

**Where:** **Browse** (`/browse`).

Browse searches all community-owned copies that are currently **available** (for trade, lend, or sale).

1. Open **Browse**.
2. Build your filter with the **query builder**, combining:
   - Free-text search.
   - Category, difficulty, condition.
   - Piece-count range.
   - Availability flags (for trade / lend / sale).
3. Results appear as a grid or list of cards, each showing the owner, a swap/lend/sale badge, and quick actions: **View**, **Request Exchange**, **Message**, **Favorite**.

### The puzzle catalogue

**Where:** **Puzzles** (`/puzzles`).

The catalogue is the community-curated list of approved puzzle definitions (not individual copies).

- Browse the infinite-scroll grid with filters.
- Open a definition (`/puzzles/<id>`) to see the cover, rating with breakdown, difficulty, category/tag pills, community stats (owners, completions, average solve days, copies available to swap), and a list of available copies with their owners.
- If you own it, you'll see an ownership banner linking to your copy.
- You can **add it to your library** from this page, **write a review**, or **contribute a new definition**.

---

## 11. The Exchange System — Lend, Swap & Sell

JigSwap supports three kinds of exchanges:

- **Swap** — trade one of your puzzles for one of theirs (puzzle-for-puzzle).
- **Sale** — sell a puzzle for a price.
- **Lend (loan)** — let someone borrow a puzzle and get it back later. Ownership never changes hands on a loan.

> **Your history is safe.** When a puzzle changes ownership through a swap or sale, your completion history stays with _you_ — it doesn't transfer to the new owner.

**Where:** **Trades** (`/trades`).

### Propose an exchange

1. Find a puzzle you want via **Browse** or a copy detail page.
2. Click **Request Exchange** / **Request Swap**.
3. Set the terms appropriate to the kind (which puzzle you're offering for a swap, a price for a sale, or an optional return date for a loan).
4. Submit. The owner receives an incoming request.

### Manage your exchanges

The **Trades** page organizes everything into tabs:

- **All**
- **Incoming** — requests sent to you.
- **Outgoing** — requests you sent.
- **Completed**
- **Borrowed** — open loans where you're currently holding someone else's puzzle.

Click **View** on any exchange to expand its details: both puzzle summaries, the partner's trust badge, and lifecycle action buttons.

### The exchange lifecycle

An exchange moves through clear steps:

1. **Proposed** — the request has been sent.
2. **Accepted / Declined** — the recipient responds. (As the recipient of an incoming request, use **Accept** or **Decline**. As the sender of an outgoing request, you can **Cancel**.)
3. **Completion** — once accepted, **both parties must confirm** completion (dual confirmation). Use **Mark Complete**.
4. **Completed** — when both confirm, ownership (swap/sale) or possession (loan) transfers, and you can **Leave a Review** of your partner.

### Returning a borrowed puzzle

If you've borrowed a puzzle (it's on the **Borrowed** tab), use the **Return** action to give it back. If you're the lender, you can **Recall** a lent-out copy from your library.

You can also **Message** your exchange partner to coordinate details.

---

## 12. Visibility & Sharing Controls

You decide who can see and interact with each puzzle copy. JigSwap uses a layered visibility model:

- **Private** — only you can see it.
- **Friend circle** — visible to members of circles you've shared it with.
- **Visible** — publicly viewable in the community.
- **Lendable** — others can request to borrow it.
- **Swappable** — others can propose a swap for it.
- **Tradeable** — available for trade/sale.

### How to set visibility

- **When adding a puzzle:** use the **availability chips** (for trade / lend / sale) and the visibility setting on the add form.
- **On an owned puzzle later:** open the copy detail page and use the **toggle for-trade / for-lend** controls, or **Edit** the copy.
- **To share with a specific group:** share the copy to a **friend circle** (see below).

> A copy that's currently out on loan is automatically made unavailable for new exchanges until it's returned.

---

## 13. Friend Circles

Friend circles are private groups for sharing puzzles only with people you trust (family, close friends).

**Where:** **Circles** (`/circles`).

### Create and manage a circle

1. Open **Circles**.
2. Create a named circle. As the creator, you are permanently the **Owner/Admin**.
3. Click **Manage** (owners only) to open the management dialog, where you can:
   - **Search for and add members** (type at least 2 characters to search).
   - Set each member's **permission level**: **View Only**, **Exchange**, or **Admin**.
   - **Remove** members.
   - **Share a specific owned copy** to the circle so members can see it.

Each circle row shows its icon, your role (Owner/Member), the member count with overlapping avatars, and a Manage button for owners.

---

## 14. Social & Community Features

### People / Social Hub

**Where:** **People** (`/people`).

- See your **network** — everyone you follow and everyone who follows you (with a "Follows you" badge).
- **Follow / Unfollow** members.
- Read an **activity feed** of recent community activity (completions, acquisitions, completed exchanges).
- Edit your **public profile** from here too.

### Comments & reviews

- **Puzzle reviews:** On a catalogue definition page, post a community comment with a 1–5 star rating.
- **Copy comments:** Discuss a specific copy on its detail page.
- **Photo comments:** In the photo lightbox, leave text comments on individual photos.

### Messages

**Where:** **Messages** (`/messages`).

A two-pane chat interface with a conversation list and a message thread.

> **Note:** The messages screen is currently a preview and is **not yet connected to live conversations**. Messaging tied to specific exchanges is planned but not fully wired up yet.

---

## 15. Your Profile & the 3D Shelf

**Where:** **Profile** (`/profile`).

Your profile is your public face on JigSwap. It shows:

- An **identity header**: avatar, name, a meta row, and your trust/reputation badge.
- An **edit toggle** that opens an inline form to update your **display name**, **bio**, **location**, and other identity fields.
- **"{Your Name}'s Shelf"** — a **3D physics-based plank** rendering your recent puzzle copies as objects on a shelf.
- Four **stat columns**.
- A **received reputation** section showing reviews others have left you.

You can also set your profile **visibility** (public or private) and **arrange your shelf** to feature up to six copies.

> The same 3D shelf also appears on your **dashboard**, showing your real owned copies.

---

## 16. Reputation & Reviews

After a completed exchange, either party can leave a **partner review** to help the community gauge reliability.

A partner review includes:

- An overall **1–5 star** rating.
- Four sub-scores: **communication**, **packaging**, **condition**, and **timeliness**.
- An optional **text comment**.

To leave one, complete an exchange and use **Leave Review** on the completed exchange (in **Trades**). You can't review yourself. Your received reviews roll up into a **reputation badge** (average rating + a credibility score) shown on your profile.

---

## 17. Notifications

**Where:** **Notifications** (`/notifications`).

JigSwap notifies you about exchange activity, goal achievements, reviews received, and puzzle moderation outcomes.

### Reading notifications

- Each notification has a type-specific icon and color, plus a read/unread indicator (unread shows a blue dot / accent background).
- **Click a notification** to jump to the relevant page; it's marked read automatically.
- Use **Mark Read** on a single item, or **Mark All Read** in the header.

### Notification preferences

**Where:** **Notifications → Settings** (`/notifications/preferences`).

- Toggle each notification **type** across each **channel**: **in-app**, **email**, and **push**.
- By default, all types are on for **in-app**; email and push are off until you enable them.
- Register a device for **push notifications** in the same screen.

---

## 18. Language Settings (English / Dutch)

JigSwap is available in **English (en)** and **Dutch (nl)**.

1. Find the **language switcher** in the app.
2. Select your preferred language.
3. The interface (and the sign-in screens) switch immediately, and your choice is remembered for future visits.

JigSwap automatically picks a starting language based on your saved preference, then your browser's language, defaulting to English.

---

## 19. Quick Search (Command Palette)

JigSwap has a global search that finds anything quickly.

- **Open it:** press **Cmd/Ctrl + K**, or click the **search pill** in the desktop top bar.
- **With nothing typed:** you'll see jump-to navigation destinations and quick-action shortcuts.
- **Type 2+ characters:** live results appear, grouped into **Puzzles**, **People**, **Circles**, and **Collections**.
- **Select a result** to navigate straight there.

---

## 20. FAQ & Troubleshooting

**Q: I added a puzzle, but it's not showing in the public catalogue. Why?**
New puzzle _definitions_ you contribute go to a moderation queue and must be **approved by an admin** before they appear publicly. Your own copy is still in your library — only the shared catalogue listing waits for approval. Until then it shows at the top of your Add-Puzzle chooser as an unapproved submission.

**Q: What's the difference between a "puzzle" and a "copy"?**
A **puzzle** (catalogue definition) is the product — title, brand, piece count, artwork. A **copy** is the specific physical puzzle _you_ own, with its own condition, photos, notes, and completion history. Multiple people can own copies of the same puzzle.

**Q: I traded a puzzle away. Did I lose my solving history?**
No. Your completion records and stats stay with **you**, not with the puzzle. The new owner gets a fresh history for their copy.

**Q: Why can't I see a puzzle I know someone owns?**
Visibility is controlled by the owner. If a copy is **private** or only shared to a **friend circle** you're not in, it won't appear in Browse for you.

**Q: A puzzle I lent out isn't available for new exchanges.**
That's expected — a copy that's on loan is automatically marked unavailable until it's returned. Use **Recall** (owner) or **Return** (borrower) to close the loan.

**Q: How do I complete an exchange? I clicked "Mark Complete" but nothing finalized.**
Exchanges use **dual confirmation** — _both_ parties must confirm completion before ownership/possession transfers. Wait for your partner to also mark it complete.

**Q: Messaging doesn't seem to work / my message didn't send.**
The Messages screen is currently a preview and is **not yet connected to live data**. Real in-exchange messaging is planned but not fully available yet.

**Q: I can't access the Admin area.**
The Admin panel (categories management and puzzle moderation) is restricted to users with the **admin role**. Regular members don't have access.

**Q: I got signed out unexpectedly.**
JigSwap keeps your session in sync; if you sign out in another tab or your session expires, you'll be returned to the sign-in screen. Sign back in and you'll resume where you were.

**Q: How do I export my data?**
Go to **Insights** and use the **data export** button to download your personal data.

**Q: How do I change the app's language?**
Use the language switcher to pick **English** or **Dutch**; your choice is saved automatically.

---

_JigSwap was made with care by a puzzle-loving family for the jigsaw puzzle community. Happy puzzling!_

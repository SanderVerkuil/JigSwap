# JigSwap User Guide

Welcome to **JigSwap** — your personal jigsaw puzzle library and exchange platform. JigSwap helps you keep track of the puzzles you own, record every puzzle you complete, set solving goals, and share or swap puzzles with friends, family, and the wider community.

This guide is written for everyday users. It explains what you can do and walks you through _how_ to do it, step by step. You don't need any technical knowledge to follow along.

---

## Table of Contents

1. [Getting Started: Account & Sign-In](#1-getting-started-account--sign-in)
2. [Finding Your Way Around](#2-finding-your-way-around)
3. [Managing Your Puzzle Library](#3-managing-your-puzzle-library)
4. [Adding & Importing Puzzles](#4-adding--importing-puzzles)
5. [Organizing with Collections](#5-organizing-with-collections)
6. [Recording Completions, Solving History & Goals](#6-recording-completions-solving-history--goals)
7. [Personal Insights & Stats](#7-personal-insights--stats)
8. [Sharing & Visibility Controls](#8-sharing--visibility-controls)
9. [The Exchange System: Lend, Swap & Trade](#9-the-exchange-system-lend-swap--trade)
10. [Discovering Puzzles & People](#10-discovering-puzzles--people)
11. [Friend Circles](#11-friend-circles)
12. [Social & Community Features](#12-social--community-features)
13. [Your Profile & the 3D Shelf](#13-your-profile--the-3d-shelf)
14. [Notifications](#14-notifications)
15. [Language & Region (i18n)](#15-language--region-i18n)
16. [FAQ & Troubleshooting](#16-faq--troubleshooting)

---

## 1. Getting Started: Account & Sign-In

JigSwap uses a secure sign-in system (powered by Clerk). Everything in your library, your solving history, and your exchanges is tied to your account.

### Create an account

1. Open JigSwap in your browser. You'll land on the public welcome page.
2. Click **Sign Up**.
3. Enter your details (email and password, or use a supported social sign-in option if available).
4. Confirm your email if prompted.
5. After signing up you'll be taken to your **Dashboard** — your personal home screen inside JigSwap.

### Sign in to an existing account

1. Click **Sign In** from the welcome page.
2. Enter your credentials.
3. You'll be returned to wherever you were trying to go, or to your Dashboard.

> **Note:** All the personal areas of JigSwap (your library, trades, profile, etc.) require you to be signed in. If you try to open one of those pages while signed out, JigSwap will send you to the sign-in screen first and bring you back automatically once you're in.

### Sign out

Use the account menu in the sidebar (bottom of the navigation) to sign out. After signing out, protected pages will again ask you to sign in.

---

## 2. Finding Your Way Around

After signing in, you're in the **dashboard area**. Navigation is grouped to match the things you'll typically want to do.

### The Dashboard (your morning briefing)

Your Dashboard is the first thing you see after signing in. It gives you an at-a-glance overview:

- A **briefing** banner that highlights pending trade requests and quick actions.
- A **3D shelf** preview of your puzzles with a count of how many you own.
- An **In Motion / Goals / Latest** section summarizing active activity and progress.
- A **fresh** section showing recently added puzzles from the wider catalog.

### Navigation groups

The sidebar organizes pages into two main groups:

- **Library** — your own things: My Puzzles, Collections, Completions, Goals, Insights.
- **Community** — shared and public things: Browse, the Puzzles catalogue, Exchanges, Circles, People, Messages.

On a **phone or small screen**, the sidebar is replaced by a top bar and a bottom tab bar so everything stays within thumb's reach. The same features are available; only the layout changes.

### Global search (the command palette)

You can jump anywhere or search instantly:

1. Press **Cmd+K** (Mac) or **Ctrl+K** (Windows/Linux), or click the search pill in the top bar.
2. Start typing (at least 2 characters) to search across **puzzles, people, circles, and collections** at once.
3. With the box empty, the palette becomes a quick navigator with shortcuts like _Add Puzzle_, _Log Completion_, _Create Circle_, and _Browse Community_.
4. Use the arrow keys and **Enter** to go to a result.

---

## 3. Managing Your Puzzle Library

Your library — **My Puzzles** — is the collection of physical puzzle _copies_ you actually own. Each copy is one real puzzle box sitting on your shelf.

### View your puzzles

1. Open **My Puzzles** from the Library group.
2. You'll see all your owned copies as cards (or as a list).
3. Use the **status filter pills** to narrow the view:
   - **All** — everything you own
   - **Available** — copies you've made available to others
   - **For Trade** — copies you'll swap or trade away
   - **For Lend** — copies you'll lend out
   - **In Progress** — puzzles you're currently solving
   - **Completed** — puzzles you've finished at least once

### Per-puzzle actions

Each puzzle card has actions available from its menu:

- **View detail** — open the full copy page (see below).
- **Edit** — change condition, notes, availability, cover, etc.
- **Delete** — remove the copy from your library (you'll be asked to confirm).
- **Log a solve** — record that you completed (or started) this puzzle.
- **Recall a loan** — if you've lent this copy out, ask for it back.
- A **loan badge** appears on copies that are currently lent out.

### The copy detail page

Click a puzzle to open its full detail page. This is the rich "story" of that single physical copy and includes:

- **Cover image** and availability badges.
- **Condition** and **difficulty**.
- **Meta** — acquisition date and source, how long it's been in your library, and tags.
- **Sharing toggles** — quickly mark the copy as For Trade or For Lend.
- A **stats strip** — number of completions, fastest finish, times lent, average rating.
- A **photo gallery** where you can upload photos of the copy.
- Timelines for **completion history**, **lending history**, and **swap history**.
- A **community rating** breakdown.
- **Comments** — notes and optional star ratings on the copy.

> **Adding photos:** On the copy detail page, choose a photo to upload. Uploaded photos are checked automatically before they appear publicly. Your own pending photos are visible to you while they're being processed.

---

## 4. Adding & Importing Puzzles

There are two related concepts in JigSwap:

- A **catalog puzzle** is the shared definition of a puzzle title (e.g. "Ravensburger — Cozy Cabin, 1000 pieces"). It's shared across all users.
- An **owned copy** is _your_ physical box of that puzzle, with your own condition, notes, and availability.

When you add a puzzle to your library, you create an owned copy that links to a catalog puzzle.

### Add a puzzle to your library

1. Open **My Puzzles** and click **Add Puzzle** (in the page header), or use the quick action from the command palette.
2. **Step 1 — Choose the puzzle.** On the chooser screen you can search the catalog and scroll through results to find a puzzle that already exists.
3. **Step 2 — Fill in your copy's details.** Once you pick a catalog puzzle, enter your copy-specific information:
   - **Condition** (from New to Damaged)
   - **Availability** (private, or for trade/lend — see [Sharing & Visibility](#8-sharing--visibility-controls))
   - **Cover** image or cover color
   - **Notes** and tags
4. Save. Your new copy appears in My Puzzles.

### Add a brand-new puzzle (not yet in the catalog)

If the puzzle doesn't exist in the catalog yet, you can create the catalog definition and your copy together in one go:

1. From the Add Puzzle flow, go to the **new puzzle form** without selecting an existing puzzle.
2. Fill in both the puzzle details (title, brand, piece count, difficulty, optional barcode/EAN/UPC and dimensions) and your copy details.
3. A **live preview card** shows how your puzzle will look as you type.
4. Save to add it to your library.

### Import a puzzle from a store URL

You don't have to type everything by hand — JigSwap can read a product page for you.

1. On the Add Puzzle form, find the **Import** box at the top.
2. Paste the web address (URL) of a puzzle product page from a puzzle store.
3. JigSwap fetches the page and pulls out a draft: **title, brand, piece count, images, and barcode (EAN/UPC)** when available.
4. If JigSwap finds a matching puzzle already in the catalog, it shows a **match banner**. You can choose to **use the existing puzzle** instead of creating a duplicate.
5. Review the pre-filled fields, adjust anything that's off, and save.

> **Tip:** Using the existing catalog match keeps community stats and reviews unified, instead of splitting them across duplicate entries.

### Contribute a puzzle to the shared catalog

If you want to add a puzzle definition to the shared catalog _without_ adding a copy to your own library:

1. Go to the **Puzzles** catalogue page (Community group) and click **Contribute**.
2. Fill in the puzzle details (you can use the same import-from-URL helper here).
3. Submit. Your contribution goes to **moderation** and becomes publicly visible once an administrator approves it.

---

## 5. Organizing with Collections

Collections are your own named shelves for grouping puzzles however you like (e.g. "Landscapes", "Kids' puzzles", "To solve in winter").

### Create a collection

1. Open **Collections** (Library group).
2. Click to create a new collection.
3. Give it a **name**, choose an **emoji icon** and a **color**, write an optional **description**, and set its **visibility** (private or public).
4. Save.

### Add puzzles to a collection

1. Open a collection, then use **Add Puzzles**.
2. Pick the owned copies you want to include.
3. Remove copies from a collection at any time from the collection's detail view.

### What a collection shows

Each collection has a stats bar with the total **piece count**, **average difficulty**, a **difficulty mix** chart, and how many puzzles in it are **up for trade**.

### Share a collection

If a collection is **public**, you can share it via a link. If it's private, JigSwap will offer to make it public so you can share it.

---

## 6. Recording Completions, Solving History & Goals

JigSwap keeps a permanent record of every puzzle you finish — even if you later trade the puzzle away.

### Log a solve

You can record a solve from a puzzle card menu, from the copy detail page, or via the command palette quick action.

1. Choose **Log a solve** for the puzzle.
2. Enter the details:
   - **Start date** and **end date**
   - **Time** spent (in minutes)
   - **Notes** about the experience
   - A **rating** (1–5 stars), optional
3. Save. You can log a puzzle as already-finished, or start one as **in progress** and finish it later.

### Finish an in-progress solve

If you logged a puzzle as in progress, open it from your completions and use **Finish** to record the end date and total time.

### Edit a completion

You can edit a completion (for example, to fix the time or add notes) within a short window after logging it.

### Review a puzzle

From a completed solve you can **Review** the puzzle, attaching a star rating that feeds into the puzzle's community rating.

### View your solving history

1. Open **Completions** (Library group).
2. You'll see your full history with a stats bar: **total finished**, **pieces placed**, and how many you've finished **this year**.

### Track goals

Set challenges for yourself and watch your progress.

1. Open **Goals** (Library group).
2. Create a goal with a **title**, **description**, a **target number of completions**, and an optional **due date**.
3. Each goal shows a **progress bar**, a percentage, and a current/target counter.
4. When you reach the target, the goal earns a **trophy badge** — and you'll get a notification.

> Goal progress updates automatically as you log completions; you don't need to update goals by hand.

---

## 7. Personal Insights & Stats

The **Insights** page (Library group) turns your activity into a personal dashboard:

- Four **stat cards** summarizing your activity (completions, solving time, ratings, exchanges, goals).
- A **completion trends** chart over time.
- A **trade activity** chart.
- A **collection breakdown** chart (e.g. by piece count, difficulty, or condition).
- A **CSV export** button so you can download your data for your own records.

To export: open **Insights** and click **Export** (CSV). The file downloads to your device.

---

## 8. Sharing & Visibility Controls

You decide exactly who can see and request each puzzle. Every owned copy has its own sharing settings, and you can change them at any time.

### Visibility levels

JigSwap uses a layered model. From most private to most open:

1. **Private** — only you can see it.
2. **Friend circle** — visible only to members of circles you've shared it into (see [Friend Circles](#11-friend-circles)).
3. **Visible** — publicly viewable, but not offered for any exchange.
4. **Lendable** — others can ask to borrow it.
5. **Swappable** — others can propose a puzzle-for-puzzle swap.
6. **Tradeable** — available to trade (and, where supported, sale).

### Set a copy's availability

1. Open the copy's detail page (or use **Edit** from My Puzzles).
2. Toggle **For Trade** and/or **For Lend** as desired, or set the visibility level.
3. Save. The change is reflected immediately, including in others' Browse results.

> **Important:** A puzzle that isn't publicly visible (private or friend-circle only) will **not** appear to people outside your circles — JigSwap keeps those copies, and your identity, hidden from non-members. Owners with a **private profile** only surface copies to people in the same circle.

---

## 9. The Exchange System: Lend, Swap & Trade

Exchanges let you move puzzles between people. JigSwap tracks the whole lifecycle and keeps your completion history intact even after a puzzle changes hands.

### Types of exchange

- **Swap** — puzzle-for-puzzle. The person starting the swap offers one of their own copies in return.
- **Trade / Sale** — a puzzle changes ownership (a sale records a price and currency).
- **Lend** — you keep ownership, but possession moves to the borrower for a while. Lending is open-ended, with an optional advisory return date.

### Propose an exchange

1. Find a puzzle you want — for example on the **Browse** page or a catalog puzzle's detail page.
2. Choose to request it (e.g. **Find Copy to Swap** from a puzzle's catalog page leads you to available copies).
3. Select the kind of exchange (swap/lend/trade). For a swap, choose which of _your_ copies you're offering.
4. Submit your proposal. The owner receives a notification.

### Manage your exchanges

1. Open **Exchanges** (Community group).
2. Use the tabs to focus:
   - **All** — every exchange you're involved in
   - **Incoming** — requests sent to you
   - **Outgoing** — requests you've sent
   - **Completed** — finished exchanges
   - **Borrowed** — puzzles you currently hold on loan
3. Expand any exchange row to see the requested/offered puzzles and your partner (with their reputation badge).

### Actions during an exchange

Depending on the stage, you'll see actions such as:

- **Accept** or **Decline** a request
- **Cancel** a request you sent
- **Mark Complete** — confirm the physical hand-over happened
- **Return** — (on the Borrowed tab) return a puzzle you borrowed
- **Leave Review** — rate your exchange partner afterward
- **Message** — coordinate details (see [Messages](#12-social--community-features))

### Completing an exchange

Completion uses **dual confirmation** — both people confirm the hand-over took place. Once both confirm:

- For a **swap/trade**, ownership transfers and the puzzle's sharing resets to private for the new owner.
- For a **lend**, possession moves to the borrower and an open **loan** is tracked until it's returned or recalled.
- The full **chain of custody** is recorded, and both parties can leave a partner review.

> Your personal completion history stays with **you**, not with the puzzle — so trading a puzzle away never erases your record of having solved it.

### Reviewing your partner

After an exchange completes, use **Leave Review** to rate the other person (overall rating plus sub-scores like communication and how accurately the puzzle was described). Reviews build each member's reputation, shown as a badge on their profile and on exchange rows.

---

## 10. Discovering Puzzles & People

### Browse available copies

1. Open **Browse** (Community group).
2. You'll see copies other people have made available.
3. Filter by **search text**, **category**, **difficulty**, **condition**, **piece count range**, and **availability type** (trade/lend/sale).
4. Toggle between **grid** and **list** view.

### Browse the puzzle catalogue

1. Open **Puzzles** (Community group) to scroll the full catalogue of approved puzzle definitions.
2. The list loads more puzzles automatically as you scroll.
3. Use the **Cmd/Ctrl+K** search to jump to a specific title.

### Puzzle detail (catalog view)

Opening a catalog puzzle shows an aggregated view across the community:

- Cover, **community star rating** with breakdown bars, and difficulty/category/tag chips.
- A stats strip: how many community members own it, total completions, average days to complete, and how many are available to swap.
- A list of **available copies** with each owner's name, location, and rating.
- Reviews and comments.
- Actions: **Add to Library**, **Find Copy to Swap**, **Write a Review**.

---

## 11. Friend Circles

Circles are private groups for sharing puzzles with people you trust — family, friends, a local puzzle club — without making those puzzles public.

### Create a circle

1. Open **Circles** (Community group).
2. Create a new circle and give it a name.

### Manage members

In a circle's **Manage** dialog you can:

1. **Add members** — search for a user (type at least 2 characters) and add them.
2. **Set permissions** for each member:
   - **View Only** — can see shared puzzles
   - **Exchange** — can also propose exchanges
   - **Admin** — can manage the circle
3. **Remove members** when needed.

### Share a puzzle into a circle

From the **Manage** dialog (or a copy's sharing settings), share a specific owned copy into the circle. That copy then becomes visible to circle members in their Browse — even if your profile is otherwise private.

---

## 12. Social & Community Features

### People (your network)

1. Open **People** (Community group).
2. See a grid of users **you follow** and users **following you**, with a _Follows you_ badge on mutual connections.
3. View an **activity feed** of what you and the people you follow have been doing (completions, new puzzles, completed exchanges).
4. Edit your own profile inline from here.

### Following

Follow other members to keep up with their activity and new additions. Following is one-directional — when someone follows you back, you're mutual connections.

### Comments & reviews

- On a **catalog puzzle**, you can write a **review** with an optional 1–5 star rating to help the community.
- On an individual **copy photo**, you can leave a **photo comment** in the lightbox.
- On a **copy**, you can leave comments with an optional star rating.

### Messages

Open **Messages** (Community group) to see conversations and threads with other members, including a composer for sending messages.

> **Note:** The Messages screen is still being connected to live data. The conversation list and chat layout are in place, and exchange coordination is also available directly from the **Message** action on each exchange.

---

## 13. Your Profile & the 3D Shelf

Your **Profile** is your public face on JigSwap.

### Open and edit your profile

1. Open **Profile** from the sidebar account area (or navigation).
2. Your profile shows an identity header: **avatar, name, username, location, bio**, and a **trust badge** based on your reputation.
3. Click to toggle the **inline edit** form, where you can update your display name, bio, and other profile fields.

### The 3D shelf (puzzle plank)

A standout feature of your profile (and your Dashboard) is the **3D shelf** — a visual "plank" that displays your puzzles like boxes standing on a real shelf.

- It appears on your Dashboard with a count of how many puzzles you own.
- On your profile, you can **curate a featured shelf** of up to six puzzles you want to highlight, arranging which copies appear.

### Profile stats & reputation

Your profile also shows your **personal stats** columns and your **received reputation** (the reviews exchange partners have left for you).

### Profile visibility

You can set your profile to **public** or **private**. A private profile hides your copies and identity from people who aren't in a shared circle with you.

---

## 14. Notifications

JigSwap keeps you informed about trade requests, acceptances, completions, messages, partner reviews, goal achievements, and puzzle approvals/rejections.

### Read your notifications

1. Click the **bell icon** in the top bar, or open **Notifications**.
2. Each notification has a type badge and an unread indicator.
3. Click a notification to jump to the relevant item (e.g. the exchange or puzzle it's about).
4. Use **Mark as read** on individual items, or **Mark all as read**.

### Notification preferences

Choose exactly what reaches you and how:

1. From the Notifications page, open **Settings** (preferences).
2. You'll see a **matrix of toggles** — one row per notification type, with columns for each channel:
   - **In-app** — shown inside JigSwap
   - **Email** — sent to your email address
   - **Push** — browser/web push notifications
3. Turn each combination on or off to suit you.

### Web push devices

In the preferences page, the **Push device** section lets you enable web push on your current browser/device and manage your push subscriptions. Your browser will ask permission the first time you enable push.

---

## 15. Language & Region (i18n)

JigSwap is available in **English** and **Dutch**.

### Switch languages

1. Find the **language switcher** (in the app's settings/menu area).
2. Choose your preferred language.
3. The interface reloads in the new language. Your choice is remembered for next time via a cookie — there's no need to change the web address.

> JigSwap detects a sensible default from your browser's language settings the first time you visit, then respects whatever you pick afterward. Dates and times are shown in the Europe/Amsterdam time zone.

---

## 16. FAQ & Troubleshooting

**I added a puzzle but it doesn't show up in the public catalogue.**
Puzzles you _contribute to the catalog_ go through moderation and only appear publicly once an administrator approves them. A copy you add to _your own library_ shows up in My Puzzles right away regardless of moderation.

**Why can't anyone see my puzzle in Browse?**
A copy only appears in others' Browse results when (1) it has an availability flag set (For Trade, For Lend, etc.) **and** (2) either your profile is public or you've shared the copy into a circle the viewer belongs to. Check the copy's sharing settings and your profile visibility.

**My imported puzzle details are wrong or incomplete.**
The import reads a store page automatically and may not catch everything. Review the pre-filled fields and edit anything that's off before saving. If a match banner appears, consider using the existing catalog entry to avoid duplicates.

**My uploaded photo isn't visible yet.**
Photos are checked automatically before becoming public. Your own pending photos are visible to you in the meantime; once approved they appear to everyone.

**I traded a puzzle away — did I lose my solving history?**
No. Your completion history belongs to you, not the puzzle. Trading or lending a puzzle never deletes your records.

**How do I get a puzzle back that I lent out?**
Use **Recall a loan** on the copy (from My Puzzles or the copy detail). The borrower can also use **Return** from their **Borrowed** tab in Exchanges.

**An exchange is stuck as "accepted" and won't complete.**
Completion requires **both** people to confirm the hand-over. Make sure both parties have used **Mark Complete**; until both confirm, the exchange stays open.

**I can't reach a page — it keeps sending me to sign in.**
Personal pages require you to be signed in. Sign in, and JigSwap will return you to the page you wanted. If it keeps happening, try signing out and back in to refresh your session.

**My language won't switch / reverts.**
The language preference is stored in a cookie. If your browser blocks cookies for the site, the choice can't be saved. Allow cookies for JigSwap and switch again.

**Where can I get more help?**
Use the **Contact** page (from the public site) to send a message, or open an issue on the project's GitHub repository.

---

_Happy puzzling! 🧩_

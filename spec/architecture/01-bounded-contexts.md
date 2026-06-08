# 1. Bounded Contexts (Strategic Design)

This document defines JigSwap's **bounded contexts** — the seams of the domain. It deliberately groups
by **business capability**, not by database table. The single most important shift from today is that
the *schema stops being the architecture*; instead, each context owns its own model, its own language,
and its own slice of persistence.

## 1.1 The entity-driven smells we are correcting

Four concrete conflations in the current model reveal where the real boundaries are:

| Today (entity-driven) | Problem | Boundary it reveals |
|-----------------------|---------|---------------------|
| `puzzles` and `ownedPuzzles` in one `puzzles.ts` | The *product* and a *physical copy of it* are different lifecycles, owners, and invariants | **Catalog** vs **Personal Library** |
| `reviews` (on exchanges) **and** `completions.review/rating` | "Review" is a homonym: trust-feedback about a *trader* vs an opinion about a *puzzle* | **Reputation** vs **Solving** |
| `adminCategories` (global) **and** `categories` (personal) | Shared taxonomy vs a user's private organisation are governed differently | **Catalog** vs **Personal Library** |
| `ownedPuzzles.availability` + `collections.visibility` + spec's 6-level model | Sharing is a *policy*, not a pile of booleans on a row | **Sharing/Friend Circles** as a policy provider |

Naming these as context boundaries — rather than just splitting tables — is what makes this DDD
rather than a tidier CRUD.

## 1.2 Subdomain classification

| Subdomain | Type | Rationale |
|-----------|------|-----------|
| **Exchange (Trading)** | **Core** | The primary value proposition ("the main reason JigSwap exists"). Richest invariants. |
| **Personal Library (Inventory)** | **Core** | Everything depends on it; the spec names it the foundational feature. |
| **Solving (Completions)** | **Core** | The differentiator vs a plain marketplace — the puzzle-solving journey. |
| **Catalog** | Supporting | Shared reference data (puzzle definitions, taxonomy, identifiers). Valuable but not unique. |
| **Reputation** | Supporting | Trust between traders; enables the core but is not itself the product. |
| **Sharing / Friend Circles** | Supporting | Differentiating (family origin story) but a policy layer over the core. |
| **Conversation (Messaging)** | Supporting | Necessary for exchanges; largely a generic chat capability scoped to the domain. |
| **Community / Social** | Supporting | Profiles, follows, activity, discovery. Network effects, secondary to trading. |
| **Identity & Access** | Generic | Auth/accounts/roles. Bought from Clerk; we wrap, not build. |
| **Notifications** | Generic | Multi-channel delivery + preferences. Reacts to everyone's events. |
| **Insights / Analytics** | Generic→Supporting | Read-side projections, trends, recommendations, exports. |

> Invest the best modelling effort in the three **Core** contexts. Keep **Generic** contexts thin and
> adapter-heavy (lean on Clerk, a notifications channel, an analytics sink).

## 1.3 The context map

```
                          ┌────────────────────────┐
                          │   Identity & Access     │  (ACL over Clerk; issues MemberId)
                          │      (Generic)          │
                          └───────────┬────────────┘
                                      │ upstream (Open Host: MemberId, roles)
        ┌───────────────┬─────────────┼───────────────┬────────────────┐
        ▼               ▼             ▼               ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Catalog    │ │ Personal     │ │   Solving    │ │ Conversation │ │   Social     │
│ (Supporting) │ │ Library      │ │   (Core)     │ │ (Supporting) │ │ (Supporting) │
│              │ │  (Core)      │ │              │ │              │ │              │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │ C/S            │ C/S            │ events          │ refs ExchangeId  │ events
       │ (PuzzleDefId   │ (CopyId        │ CompletionRec.  │                  │ (activity feed)
       │  + ACL snap)   │  supplier)     ▼                 │                  │
       │                │         ┌──────────────┐         │                  │
       └───────────────►│◄────────┤   Exchange   ├─────────┘                  │
        Library holds   │ Ownership│   (Core)     │  ExchangeCompleted ───────┘
        PuzzleDefId     │ Transferred└──────┬─────┘  ───────────┐
                        │  event           │ events             ▼
                        ▼                  │            ┌──────────────┐
                ┌──────────────┐           │            │  Reputation  │
                │ Sharing /    │           │            │ (Supporting) │ opens review window
                │ Friend       │ Visibility│            └──────────────┘
                │ Circles      │ policy     │
                │ (Supporting) ├────────────┘
                └──────────────┘
                        │
         all contexts publish domain events ─────────────► ┌──────────────┐   ┌──────────────┐
                                                            │ Notifications│   │  Insights    │
                                                            │  (Generic)   │   │ (read models)│
                                                            └──────────────┘   └──────────────┘
```

**Relationship legend**

- **C/S** = Customer/Supplier (downstream depends on upstream; upstream publishes a stable language).
- **ACL** = Anti-Corruption Layer (downstream translates the upstream model into its own; never lets
  foreign concepts leak in).
- **events** = the context publishes **domain events**; downstream contexts subscribe. This is how we
  decouple — e.g. Notifications and Insights are pure subscribers and depend on *no one* directly.

### Key relationships, stated precisely

1. **Identity → everyone (Open Host + ACL).** Identity wraps Clerk. It is the *only* context that knows
   `clerkId` exists. It publishes a clean `MemberId` and role claims. Every other context speaks
   `MemberId`, never Clerk. *(Fixes: today `clerkId` and Clerk's identity leak everywhere via
   `ctx.auth.getUserIdentity()`.)*

2. **Catalog → Personal Library (Customer/Supplier + ACL).** A `Copy` in the Library references a
   `PuzzleDefinitionId` from the Catalog and caches a **denormalised snapshot** (title, brand, piece
   count, thumbnail) behind an ACL, so the Library keeps working if the Catalog evolves. *(Fixes: the
   `puzzles`/`ownedPuzzles` conflation.)*

3. **Personal Library → Exchange (Customer/Supplier).** An Exchange references `CopyId`s. The Library
   exposes a **`CopyAvailability` port** the Exchange uses to *reserve/lock* a copy. The Exchange never
   reaches into Library tables.

4. **Exchange → Library + Reputation (event-driven).** On settlement, Exchange emits
   `OwnershipTransferred` and `ExchangeCompleted`. The **Library** reacts by creating a *new* `Copy`
   for the new owner and recording **chain-of-custody** (the documented-but-unbuilt requirement —
   it falls out naturally here). **Reputation** reacts by opening a review window. *(Fixes: completion
   today just flips booleans; no custody history.)*

5. **Solving → Catalog/Library (references) + events.** A `Completion` references a `PuzzleDefinitionId`
   (and optionally a `CopyId`). It publishes `CompletionRecorded` consumed by Insights, Social
   (activity feed) and Notifications (goal achieved).

6. **Sharing/Friend Circles → Library + Exchange (policy supplier).** Circles provide a
   **`VisibilityPolicy` port**: "can member M see copy C?" Library and Exchange *ask* the policy; they
   don't embed circle logic. *(Fixes: fragmented visibility booleans; unifies the 6-level model.)*

7. **Conversation → Exchange (conformist).** Threads are scoped to an `ExchangeId` today. Conversation
   conforms to the Exchange's identifiers. (Direct messaging later would relax this.)

8. **Notifications & Insights → all (subscribers/conformist).** They consume the **published event
   language** and own no write model that others depend on. Generic, replaceable.

## 1.4 Contexts in detail

Each context lists: **purpose**, **ubiquitous language** (and any homonym disambiguation), **aggregates
& invariants**, and the **events** it publishes/consumes.

### Catalog *(Supporting)*

- **Purpose:** the shared, moderated encyclopaedia of puzzle *products* — "what a puzzle is", independent
  of who owns a copy.
- **Language:** `PuzzleDefinition` (the product; **not** "OwnedPuzzle"), `Brand`, `Artist`, `Series`,
  `PieceCount`, `Barcode` (EAN/UPC/model), `CatalogCategory` (global taxonomy, en/nl), `Approval`
  (`Pending → Approved | Rejected`), `Submission`.
- **Aggregates:**
  - `PuzzleDefinition` (root). Invariants: barcode uniqueness; only `Approved` definitions are
    publicly listable; `searchableText` is a derived projection, not authored state.
  - `Taxonomy` / `CatalogCategory` (root). Invariant: stable sort order; soft-deactivation, not deletion.
- **Publishes:** `PuzzleDefinitionApproved`, `PuzzleDefinitionUpdated`.
- **Note:** `favorites` (bookmarking a *definition*) belongs here or in Social; recommend Catalog
  (it's about the product), exposed to Social via events.

### Personal Library / Inventory *(Core)*

- **Purpose:** what a member owns and how they organise it.
- **Language:** `Copy` (a physical instance of a `PuzzleDefinition`; today's `ownedPuzzle`), `Condition`,
  `Acquisition` (date/source/price), `Collection`, `Wishlist` (a Collection of *desired*, not owned,
  definitions), `Shelf`/`CollectionMember`, `PersonalCategory`, `SharingSetting`.
- **Homonym fix:** `PersonalCategory` (here) ≠ `CatalogCategory` (Catalog). `Copy` ≠ `PuzzleDefinition`.
- **Aggregates:**
  - `Copy` (root). Invariants: a `Copy` cannot be marked available while **reserved** by an active
    Exchange; condition transitions are append-only (feeds a condition timeline); images belong to the
    Copy. Holds the cached Catalog snapshot (ACL).
  - `Collection` (root). Invariants: membership references only the owner's own copies; a default
    collection cannot be deleted; visibility resolved via the Sharing policy.
  - `Wishlist` — a Collection variant referencing `PuzzleDefinitionId`s rather than `CopyId`s.
- **Consumes:** `OwnershipTransferred` (creates a new `Copy` + custody entry).
- **Publishes:** `CopyAcquired`, `CopyConditionChanged`, `CopyMadeAvailable`/`Unavailable`.

### Solving *(Core)*

- **Purpose:** the member's puzzle-solving journey and goals.
- **Language:** `Completion` / `SolveSession` (start/end, duration, in-progress vs done), `PuzzleReview`
  (opinion **of the puzzle**, 1–5 + text — *this* is the "review" the marketing means by ratings),
  `Goal` (target completions + deadline), `Progress`, `Streak`.
- **Homonym fix:** `PuzzleReview` (here, about the product) ≠ `PartnerReview` (Reputation, about a person).
- **Aggregates:**
  - `Completion` (root). Invariants: `end ≥ start`; duration consistent; editable only within 24h
    (documented rule); up to 5 photos; can reference a `PuzzleDefinitionId` and/or a `CopyId`.
  - `Goal` (root). Invariant: `currentCompletions` is **derived** from completions, never hand-set;
    achievement is computed.
- **Publishes:** `CompletionRecorded`, `GoalAchieved`, `PuzzleReviewed`.

### Exchange / Trading *(Core)*

- **Purpose:** transfer or lend copies between members, safely, with a clear lifecycle.
- **Language:** `Exchange` (root transaction), `Offer`/`Terms`, exchange **kinds** `Lend | Swap | Trade
  (sale)` (+ `Auction` later), `Settlement`, **dual confirmation**, `OwnershipTransfer`, `Dispute`,
  `ChainOfCustody`.
- **Aggregate:** `Exchange` (root) — owns the **state machine**:

  ```
  Proposed ──accept──► Accepted ──bothConfirm──► Completed
     │ │                  │
     │ └─decline─► Rejected│
     └───cancel──► Cancelled (from Proposed/Accepted)
                        └────raiseDispute──► Disputed
  ```

  Invariants: only legal transitions; kind-specific terms (loan ⇒ `returnDate`; sale ⇒ `price`);
  **a copy may be reserved by at most one active Exchange**; `Completed` requires *both* parties'
  confirmation; settlement emits exactly one `OwnershipTransferred` per transferred copy.
- **Uses (ports):** `CopyAvailability` (Library), `VisibilityPolicy` (Sharing — can the recipient even
  see/transact this copy?), `Clock`.
- **Publishes:** `ExchangeProposed`, `ExchangeAccepted/Rejected/Cancelled`, `ExchangeCompleted`,
  `OwnershipTransferred`, `DisputeRaised`.

### Reputation *(Supporting)*

- **Purpose:** trust between trading partners.
- **Language:** `PartnerReview` (about a *person*, sub-scores: communication, packaging, condition,
  timeliness — today's `reviews`), `ReputationProfile` (aggregate score + credibility), `ReviewWindow`.
- **Aggregates:** `ReputationProfile` (root, per member); `PartnerReview`. Invariants: one review per
  party per completed exchange; reviews only within the window after `ExchangeCompleted`.
- **Consumes:** `ExchangeCompleted` (opens windows). **Publishes:** `ReputationChanged`.

### Sharing / Friend Circles *(Supporting)*

- **Purpose:** private groups + the unified **visibility policy** (the documented 6-level model:
  private / friend-circle / visible / lendable / swappable / tradeable).
- **Language:** `Circle`, `Membership`, `PermissionLevel` (`ViewOnly | Exchange | Admin`),
  `VisibilityScope`, `VisibilityPolicy`.
- **Aggregate:** `Circle` (root) — memberships + permissions. Invariants: admins manage membership;
  a member sees circle content only while a member.
- **Provides (port):** `VisibilityPolicy.canView(member, copy)` / `canTransact(...)`.
- **Publishes:** `MemberJoinedCircle`, `CopySharedToCircle`.

### Conversation *(Supporting)*

- **Purpose:** real-time messaging, today scoped to an exchange.
- **Language:** `Thread` (per `ExchangeId`), `Message` (`text | image | system`), `Participant`,
  `ReadReceipt`.
- **Aggregate:** `Thread` (root). Invariants: only participants post; system messages are
  service-authored. **Publishes:** `MessagePosted`.

### Community / Social *(Supporting, mostly planned)*

- **Purpose:** profiles, following, activity feeds, discovery.
- **Language:** `Profile`, `Follow`, `ActivityFeed` (read model), `Discovery`, `Trending`.
- **Aggregates:** `Profile`, `Follow`. `ActivityFeed` is a **projection** built from events
  (`CompletionRecorded`, `CopyAcquired`, `ExchangeCompleted`).

### Identity & Access *(Generic)*

- **Purpose:** the ACL over Clerk; account lifecycle and roles.
- **Language:** `Member` (internal identity; wraps `clerkId`), `Account`, `Role` (`admin | moderator`),
  `Session`.
- **Aggregate:** `Member` (root). Invariants: one `Member` per Clerk subject; role changes audited.
  **Consumes:** Clerk webhooks. **Publishes:** `MemberRegistered`, `MemberDeactivated`.

### Notifications *(Generic)*

- **Purpose:** turn domain events into delivered messages across channels.
- **Language:** `Notification`, `Channel` (`inApp | email | push`), `Preference`, `Digest`.
- **Aggregates:** `NotificationPreference` (root, per member); `Notification`.
- **Consumes:** events from *all* contexts. *(Fixes: today every mutation inserts notification rows
  inline — replaced by event subscription.)*

### Insights / Analytics *(Generic → Supporting)*

- **Purpose:** read-side projections — personal stats, community trends, recommendations, exports.
- **Language:** `Metric`, `Trend`, `Recommendation`, `Export`, `Projection`.
- **No write aggregates.** Pure **read models** built by subscribing to events. Exports are a
  query-side concern. Recommendations are a downstream model over Solving/Library/Catalog events.

## 1.5 Glossary of homonyms (the disambiguations that matter)

| Word in the wild | In context… | means… |
|------------------|-------------|--------|
| **Puzzle** | Catalog | `PuzzleDefinition` — the product/design |
| | Personal Library | `Copy` — one physical instance someone owns |
| **Review** | Solving | `PuzzleReview` — opinion of the puzzle |
| | Reputation | `PartnerReview` — trust feedback about a trader |
| **Rating** | Solving | difficulty/quality of the puzzle |
| | Reputation | trustworthiness of the partner |
| **Category** | Catalog | `CatalogCategory` — global, moderated, en/nl |
| | Personal Library | `PersonalCategory` — user's private label |
| **Visibility / Availability** | Sharing | a `VisibilityPolicy` decision, not a row boolean |

Carrying these distinctions into code (module names, type names, function names) is the concrete
deliverable of strategic design — see [`02-hexagonal-architecture.md`](./02-hexagonal-architecture.md).

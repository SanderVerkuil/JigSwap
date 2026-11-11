# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Households and friends with shelves of jigsaw boxes who already pass puzzles between each other. Dutch first, English second. They are often at home, deciding what to do next or remembering who has what. Puzzlers outside their own circle are a later step, not the first audience.

## Product Purpose

JigSwap lets a household and its friends see what puzzles everyone owns, then borrow, lend or swap them. It began as a family side project in 2025 because the family kept asking friends and relatives "what puzzles do you have?". Success is a box getting opened more often: a puzzle moves to the next person and nobody loses track of it.

## Positioning

See everyone's shelf: the one place where the puzzles owned by your family and friends are visible together, and where borrowing one is a single request away. A shop sells a box and a swap forum lists strangers' boxes; JigSwap shows the shelves of people you already know.

## Operating Context

A home with physical boxes on a shelf, a kitchen table with a puzzle in progress, and a box handed over in person. People look things up on a phone next to the shelf and manage their library on a laptop. Boxes carry a brand, a piece count, a condition and a cover image, and they change hands for a while or for good.

## Capabilities and Constraints

- Library: My Puzzles, Collections, Household, Completions, Goals and Insights.
- Community: Browse, the shared puzzle catalogue, Circles, Exchanges, Messages and People.
- Public site: home, How it works, catalogue, Features, About, Docs, Contact, Privacy and Terms, on jigswap.site.
- Bilingual in English and Dutch through `apps/web/locales`; every visible string goes through translations.
- Light and dark themes; installable as a PWA. The signed-in shell has separate desktop and mobile layouts.
- Stack: TanStack Start, React, Tailwind CSS v4, shadcn/ui, Convex and Clerk.
- Open: one word for exchange. The product says trade, swap and exchange interchangeably, and the owner has not chosen one. Do not rename across the product without asking.

## Brand Commitments

- The name JigSwap and the puzzle-piece logo mark are kept. The owner confirmed that everything else in the current look may change, including the violet palette, grounds, buttons and type.
- Family side project voice: "hobby, not hustle", plain and warm, never a growth pitch. The site is honest that a family runs it.
- Third-party puzzle brands stay out of JigSwap's own marketing imagery; real box covers only appear as catalogue content (the owner moved the marketing covers to original art in #391).

## Evidence on Hand

- Original illustrated scenes in the JigSwap style, in `assets/`: `dutch-vilage-street.png`, `puzzle-house.png`, `puzzle-swap-party.png`, `puzzle-party-2.png`, `puzzle-party-3.png`, plus newer renders of the house, the kitchen table, the park, one box's four-step journey and all 14 box lids, kept as lossless WebP (`assets/README.md` maps each to the site files made from it). The owner approved them as the main imagery. Crops ship from `apps/web/src/components/marketing/assets/art/`.
- Live platform counts from the real database: members, catalogue puzzles, puzzles on shelves. The owner keeps these on the home page, whatever their current size.
- The family's own quote and the kitchen-table story on About.
- There are no customer testimonials, press mentions, partner logos or pricing. Do not invent any.

## Product Principles

1. Show people's shelves, not features: the boxes and the people who own them are the content.
2. Keep track so nobody has to ask: who has which box is always answerable.
3. Hobby, not hustle: no urgency, gamified pressure or growth tricks.
4. Honest numbers and honest authorship: a small real number beats a large invented one.
5. Dutch and English are equals: every layout has to survive the longer Dutch strings.

## Accessibility & Inclusion

WCAG 2.2 AA is the working standard (the 29 October 2026 review measured against it with axe). Respect `prefers-reduced-motion`. Text on imagery and themed grounds must meet contrast in both themes.

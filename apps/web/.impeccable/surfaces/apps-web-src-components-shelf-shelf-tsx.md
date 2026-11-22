---
version: 1
slug: "apps-web-src-components-shelf-shelf-tsx"
primary_target: "apps/web/src/components/shelf/shelf.tsx"
related_targets:
  [
    "apps/web/src/components/dashboard-home/shelf-section.tsx",
    "apps/web/src/components/profile/shelf-section.tsx",
    "apps/web/src/components/members/profile-body.tsx",
    "apps/web/src/routes/_dashboard/collections/index.tsx",
    "apps/web/src/components/household/household-puzzles.tsx",
    "apps/web/src/routes/_public/catalog/index.tsx",
    "apps/web/src/components/marketing/home/hero.tsx",
  ]
---

## Scope

The shelf: one element, a row of puzzle boxes standing on a plank-tan ledge, used wherever JigSwap shows somebody's boxes. Mode: Operate inside the app (dashboard Your shelf, own profile, member pages, Collections, Household), Persuade where the public catalogue grid and the home hero's drawer use it. It inherits the street world; DESIGN.md stays the authority for tokens.

## Audience and task

Household members and friends looking at whose boxes are where: glancing at their own newest boxes on the dashboard, curating what their profile shows, browsing a friend's or housemate's shelf, and opening a box to see or borrow it. Phone next to the real shelf, laptop for the library. Play is a rare, playful extra.

## Decisions (owner, 2026-11-21)

- Flat at rest on every device and page; Play turns that same shelf 3D in place (grab, throw, Reset puts the boxes back and the shelf returns to flat). three.js and rapier load only on Play.
- Play is offered on every app shelf, never with reduced motion, Save-Data or low memory.
- Each box opens its puzzle (a real link named by its title).
- The element comes back on Collections (each collection is a named shelf), Household (the household's shared shelf) and the public catalogue grid and home hero drawer (rebuilt on the same parts).

## Direction contract

THESIS: One shelf for the whole street: real boxes standing on one tan plank, the same object on a phone, a laptop, the dashboard, a friend's page and the public catalogue. It refuses the product-render slab (perspective board, studio lighting, rounded boxes, pointer tilt) and the isometric clip-art fallback.

OWN-WORLD: Plank tan #e4c79a ledge (night #8a6a3b), 9px, square ends, running the full width of the row. Covers bottom-aligned on it, 2px top corners, square bottoms, width following piece count. A box without a cover is a painted lid in a street colour (canal link, amber, chart blue, tulip) with its title in Young Serif and the piece count in tabular Hanken. No gradients, pills, uppercase or shadows at rest.

STORY: A member sees their boxes standing where they belong, recognises each by its lid, opens one with a tap, and on a slow evening presses Play and throws them about before putting them back.

FIRST VIEWPORT: Dashboard, 1440: under the canal briefing band, the Your shelf head (serif title, meta, All my puzzles), then up to five boxes left-aligned on a ledge across the shelf column, with the member's figures beside it from xl, standing level with the ledge; Play sits under the ledge's right end. Cited adaptation (an earlier owner rule, statRowsFor): a member with no exchange, rating or review yet gets the owned figure alone, and the head drops its meta then, which would only repeat it. Phone: three boxes on a full-width ledge, the figures in a 2x2 grid below (or the owned row alone).

FORM: Extension of the established street world (new-work §3, "Extend an existing surface"): no concept round and no roll, so there is no seed reference to record. Signature interaction: Play lifts the flat shelf into depth where it stands; the first 3D frame matches the flat boxes to the pixel, the camera eases a few degrees up to show the box tops, and Reset settles every box back on its spot before the shelf goes flat again. Motion grammar: hover lifts a box 3px off the ledge (pointer devices), press 0.97, 150ms strong ease-out, nothing tilts, reduced motion keeps everything at rest.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

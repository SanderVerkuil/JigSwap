---
version: 1
slug: "apps-web-src-components-dashboard-layout-shell-tsx"
primary_target: "apps/web/src/components/dashboard-layout/shell.tsx"
related_targets: ["apps/web/src/styles/globals.css"]
---

## Scope

Signed-in app shell: frame, sidebar, top bar, page head, mobile top bar and tab bar, quick sheet, and the tokens and primitives they share. Mode: Operate. Routes, information architecture and behaviour stay as they are.

## Audience and task

Household members checking who has what, adding a box and answering a request, on a laptop or on a phone next to the shelf. Several short visits a week. Reaching the right page quickly and seeing what needs an answer are the jobs.

## Decisions

- The shell inherits the street world from the marketing surface. The world lends type, palette, density and one signature move, and never the layout, navigation model or controls.
- Taste style: framed-sheet with palette and type kept. Sky tint replaces the study's grey frame; this is its "frame tinted from the product's colour" face.
- Marigold appears on one action only (Add Puzzle). Canal green is the everyday primary.

## Direction contract

THESIS: The app is the same street seen from indoors: a calm sky frame around a white sheet of work. It refuses the template dashboard: tinted pill navigation, frosted page heads, uppercase captions, greeting emoji and glowing action buttons.

OWN-WORLD: Sky-tint frame, white sheet, canal-green ink and primary, one marigold action. Young Serif for page titles and group names, Hanken Grotesk for all interface text. Flat surfaces with a single tone step, small radii, tabular figures.

STORY: A member opens the app, knows the product by its frame and skyline, finds the page in the side navigation, sees its title and one primary action, and gets on with it.

FIRST VIEWPORT: Desktop: sky L-frame with logo, search and account controls along the top, side navigation with serif group names, and a white sheet inset on the right and bottom with the title row at its top. A quiet gable skyline sits at the foot of the sidebar behind the account row. Phone: the sheet is the screen under a slim sky top bar, with a bottom tab bar and one marigold add button.

FORM: Framed sheet from the street world, seed:e0ac332771293b33. Signature move: a tone-on-tone gable skyline at the foot of the sidebar, whose windows light up in dark mode. Motion grammar: no animation on keyboard-driven or high-frequency actions; press feedback on controls; popovers scale from their trigger; everything under 300ms.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

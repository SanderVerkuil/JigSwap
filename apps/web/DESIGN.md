---
name: JigSwap
description: See everyone's shelf. A Dutch street with its fronts off, and the same street seen from indoors.
colors:
  sky: "#b4dcf8"
  sky-soft: "#dceffc"
  sky-frame: "#e3f1fa"
  sky-frame-step: "#cfe6f5"
  sky-frame-line: "#cbe0ec"
  canal-ink: "#0f3b30"
  canal-primary: "#134a3c"
  canal-link: "#146350"
  on-canal: "#ffffff"
  marigold: "#ffb81c"
  marigold-press: "#f4a900"
  plank: "#e4c79a"
  sheet: "#ffffff"
  surface-secondary: "#eaf4fa"
  surface-muted: "#eef5f9"
  ink-muted: "#4a655d"
  ink-muted-public: "#3f5f56"
  line: "#d8e5eb"
  line-input: "#c6d6dd"
  tulip: "#c8321f"
  leaf: "#1e7b34"
  amber: "#a86400"
  danger: "#c62828"
  destructive: "oklch(0.577 0.245 27.325)"
  logo-jig: "#4a37b8"
  logo-swap: "#128a10"
  chart-2: "#e09a00"
  chart-3: "#2b7bb9"
  chart-5: "#8a6a3b"
  night-sheet: "#15343d"
  night-card: "#1b3f49"
  night-raised: "#234a54"
  night-accent: "#2a5561"
  night-frame: "#0f2a33"
  night-canal: "#0b2028"
  night-ink: "#eaf4f7"
  night-ink-muted: "#a9c6cc"
  night-primary: "#1f7a63"
  night-link: "#8fdcc6"
  night-plank: "#8a6a3b"
  night-logo-jig: "#a79cf7"
  night-logo-swap: "#4fd14c"
typography:
  display-hero:
    fontFamily: "Young Serif, Georgia, Times New Roman, serif"
    fontSize: "min(calc((100cqw - 80px) / 10.2), 15svh)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.012em"
  display-page:
    fontFamily: "Young Serif, Georgia, Times New Roman, serif"
    fontSize: "clamp(38px, 6vw, 104px)"
    fontWeight: 400
    lineHeight: 1.03
    letterSpacing: "-0.015em"
  headline-section:
    fontFamily: "Young Serif, Georgia, Times New Roman, serif"
    fontSize: "clamp(32px, 4.4vw, 68px)"
    fontWeight: 400
    lineHeight: 1.06
  title-storey:
    fontFamily: "Young Serif, Georgia, Times New Roman, serif"
    fontSize: "clamp(28px, 3vw, 44px)"
    fontWeight: 400
    lineHeight: 1
  statement:
    fontFamily: "Young Serif, Georgia, Times New Roman, serif"
    fontSize: "clamp(24px, 2.5vw, 36px)"
    fontWeight: 400
    lineHeight: 1.3
  title-page:
    fontFamily: "Young Serif, Georgia, Times New Roman, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.33
  title-section:
    fontFamily: "Young Serif, Georgia, Times New Roman, serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.4
  label-group:
    fontFamily: "Young Serif, Georgia, Times New Roman, serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  body-public:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.5
  body-app:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  action-public:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.5
  action-app:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.43
  label:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
  figure:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "tnum"
  wordmark:
    fontFamily: "Baloo 2, Hanken Grotesk, sans-serif"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1
rounded:
  sm: "2px"
  md: "4px"
  lg: "6px"
  xl: "10px"
  sheet: "12px"
  bubble: "16px"
  full: "9999px"
spacing:
  base: "4px"
  board-gutter: "6px"
  sheet-inset: "8px"
  phone-edge: "16px"
  sheet-pad: "24px"
  wide-edge: "40px"
components:
  button-primary:
    backgroundColor: "{colors.canal-primary}"
    textColor: "{colors.on-canal}"
    typography: "{typography.action-app}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-marigold:
    backgroundColor: "{colors.marigold}"
    textColor: "{colors.canal-ink}"
    typography: "{typography.action-app}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-marigold-hover:
    backgroundColor: "{colors.marigold-press}"
  button-marigold-public:
    backgroundColor: "{colors.marigold}"
    textColor: "{colors.canal-ink}"
    typography: "{typography.action-public}"
    rounded: "{rounded.xl}"
    padding: "0 22px"
    height: "50px"
  button-outline:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.canal-ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.surface-secondary}"
    textColor: "{colors.canal-ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.canal-ink}"
    typography: "{typography.body-app}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.canal-ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  nav-item:
    textColor: "{colors.canal-ink}"
    typography: "{typography.body-app}"
    rounded: "{rounded.md}"
    padding: "8px"
  nav-item-hover:
    backgroundColor: "{colors.sky-frame-step}"
  nav-item-active:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.canal-ink}"
  floor-pin:
    backgroundColor: "{colors.canal-ink}"
    textColor: "{colors.on-canal}"
    rounded: "{rounded.xl}"
    padding: "0 18px"
    height: "46px"
  floor-pin-active:
    backgroundColor: "{colors.marigold}"
    textColor: "{colors.canal-ink}"
  shell-sheet:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.sheet}"
  plank-ledge:
    backgroundColor: "{colors.plank}"
    height: "9px"
---

# Design System: JigSwap

## Overview

**Creative North Star: "The Street With the Fronts Off"**

Take the fronts off a Dutch street and every household's shelf is on view. That one idea drives two surfaces in one world. On public pages (Persuade) the visitor stands outside: a flat sky field, canal-green ink, and bands of filled colour stacked like storeys, with original wimmelbild art as the only imagery. In the signed-in shell (Operate) the same street is seen from indoors: a calm sky frame around a white sheet of work. The world lends the shell its type, palette and one signature, the gable skyline; it never lends layout or controls.

Density follows the mode. Public pages are large and full-width, with type that scales to the viewport and bands that meet edge to edge. The shell is compact, with 14px interface text, 36px controls and tabular figures. Dark mode is not a different theme: it is the same street at night, with lit windows, and every surface stays well above black.

**The Own Art Rule.** JigSwap's own surfaces use only original wimmelbild illustration. Real third-party box covers appear only as catalogue content, in the catalogue and on members' shelves. Public home-page boxes are drawn covers from the same art set.

**Key Characteristics:**

- Two surfaces, one world: Persuade on a sky field, Operate on a white sheet in a sky frame.
- Filled shapes with real edges, plank-tan ledges and a drawn gable skyline, not cards on grey.
- One display face in one weight, one text face that also carries all data.
- Marigold is scarce in the shell and loud only in the public world.
- Motion is press feedback and short entrances, with one loud moment in the curtain footer.

## Colors

Sky blue, canal green and marigold on white, with plank tan as the one warm ledge. Values below are the light theme; `night-*` tokens are the same roles after dark.

### Primary

- **Canal Primary** (#134a3c): the everyday action in the shell: default buttons, tooltips, primary badges.
- **Canal Ink** (#0f3b30): all text on light grounds, ink on marigold, the canal storey and the public floor pins.
- **Canal Link** (#146350): primary as text on page surfaces (links, chips, icons) and the focus ring colour of inputs.

### Secondary

- **Marigold** (#ffb81c) with **Marigold Press** (#f4a900) on hover: the main action on public pages; Add Puzzle and the phone add button in the shell. Text on it is always Canal Ink, at 7.18:1.
- **Sky** (#b4dcf8): the public field: header, hero, page heroes and the closing call to action.
- **Sky Soft** (#dceffc): the quieter public band and footer tiles.
- **Sky Frame** (#e3f1fa) with **Frame Step** (#cfe6f5) and **Frame Line** (#cbe0ec): the shell's L-frame, its hover step and its edge. Frame Step is also the tone-on-tone skyline. The browser `theme-color` and the manifest use Sky Frame.

### Tertiary

- **Plank** (#e4c79a): ledges that boxes stand on, and the legal footer tile.
- **Tulip** (#c8321f): unread dots and counts. Chart colours reuse it, Canal Link and three chart-only tones.
- **Leaf** (#1e7b34), **Amber** (#a86400), **Danger** (#c62828), **Destructive** (`oklch(0.577 0.245 27.325)`): status only.

### Neutral

- **Sheet** (#ffffff): the working sheet, cards, popovers, public page ground and shelf drawers.
- **Surface Secondary** (#eaf4fa) and **Surface Muted** (#eef5f9): sky-tinted single steps for secondary buttons, tab tracks and quiet fills.
- **Ink Muted** (#4a655d), and **Ink Muted Public** (#3f5f56) on public pages: secondary text.
- **Line** (#d8e5eb) and **Line Input** (#c6d6dd): edges and field outlines.

### Night

- **Night Frame** (#0f2a33) and **Night Sheet** (#15343d): sky and sheet after dark, the frame slightly deeper than the sheet. **Night Card** (#1b3f49), **Night Raised** (#234a54) and **Night Accent** (#2a5561) step upward from there.
- **Night Canal** (#0b2028): the deepest colour in the system, used for the canal storey and footer board.
- **Night Ink** (#eaf4f7), **Night Ink Muted** (#a9c6cc), **Night Link** (#8fdcc6), **Night Primary** (#1f7a63) and **Night Plank** (#8a6a3b) carry their daytime roles. Marigold does not change at night; only its ink does (#0f2a33).

### Named Rules

**The Reserved Marigold Rule.** In the shell, marigold is an action colour for Add Puzzle in the top bar and the phone add button, and for nothing else that can be pressed. Everyday primaries are canal green. Its only other shell appearances are non-action marks: rating stars, text selection, and the night skyline's windows.

**The Public Marigold Rule.** On public pages marigold marks the main action. The hero extends it to the things that act on that same promise: each "ask to borrow" button in the docked shelf, and the chosen floor pin. A long page may also carry one full marigold storey (Discover on home, its counterpart on Features). The closing call to action stays a marigold button on sky, not a marigold band.

**The Logo's Own Colours Rule.** The wordmark takes `logo-jig` and `logo-swap`, and the violet raster mark stays as drawn, whatever the theme's primary does. The pair has a lifted night version for legibility. The single exception is the footer's giant name, knocked out in one light colour because the two-tone logo turns garish at that size on ink.

**The Night Street Rule.** Dark mode keeps the street's hues and stays clearly above black: nothing in the theme goes below Night Canal (OKLCH lightness 0.23), and working surfaces start at Night Sheet (0.31). Black appears only as a translucent scrim over content.

## Typography

**Display Font:** Young Serif (with Georgia, Times New Roman, serif)
**Body Font:** Hanken Grotesk (with ui-sans-serif, system-ui, sans-serif)
**Label/Mono Font:** Baloo 2 for the logo's wordmark only. Technical strings use the system monospace stack.

**Character:** A sturdy, slightly old-fashioned serif, like painted lettering on a canal house, over a plain warm grotesque that stays out of the way of names and numbers. Atkinson Hyperlegible was tried for the text role and rejected: its slashed zeros misread piece counts.

### Hierarchy

- **Display Hero** (400, scaled so the line fills the measure and capped at 15svh, 1): the home h1, on one line from 760px, in the sky.
- **Display Page** (400, `clamp(38px, 6vw, 104px)`, 1.03): public sub-page titles.
- **Headline Section** (400, `clamp(32px, 4.4vw, 68px)`, 1.06): public section statements. The How preview starts at 40px; Sustain runs `clamp(30px, 3.6vw, 52px)`.
- **Title Storey** (400, `clamp(28px, 3vw, 44px)`, 1; 22px on phones): the band title of a feature storey.
- **Statement** (400, `clamp(24px, 2.5vw, 36px)`, 1.3): the family's quote and the live-count sentence.
- **Title Page** (400, 1.5rem): page titles in the sheet head; 1.25rem in the phone top bar.
- **Title Section** (400, 1.25rem): dashboard section heads and the briefing sentence.
- **Label Group** (400, 15px): sidebar group names, in the serif.
- **Body Public** (400, 18px, 1.5; leads `clamp(18px, 1.5vw, 21px)`, measure 46ch): reading text on public pages.
- **Body App** (400, 0.875rem): all interface text; fields rise to 1rem on phones.
- **Action** (public 700, 18 to 20px; app 500, 0.875rem): button labels.
- **Label** (500, 0.75rem): tab bar labels, stat captions, badges. Sentence case.
- **Figure** (600, 1.5rem to 1.875rem, `tnum`): numbers in the app, in the text face.

### Named Rules

**The One Weight Rule.** Young Serif has one weight, 400. `font-synthesis-weight: none` on the root means a bold on it renders as regular, never as a browser-faked bold. Build hierarchy through size. Do not write a weight on the display face.

**The Figures Rule.** Figures that are data in the app use Hanken Grotesk with tabular numerals. Young Serif's old-style figures misread as data. The home page's live-count sentence is the recorded exception: there the figures are words in a public sentence, not a readout.

**The Logo Lettering Rule.** Baloo 2 at 700 sets the wordmark and nothing else.

## Layout

**Shell, from 768px.** A sky L-frame of a 48px top bar and a 16rem sidebar, with no rule between them. The white sheet butts both and is inset 8px from the window's right and bottom. The page head sticks to the sheet's top on a solid ground with one quiet edge; content pads 24px and scrolls inside the sheet, passing under the head. Frame, sheet and card are the only three levels. Content is full width by default, or a centred 1180px column by preference; `/messages` is full-bleed.

**Shell, below 768px.** A dedicated phone layout rather than a squeezed one: the document scrolls, under a 56px sticky sky top bar and above a five-slot bottom tab bar of at least 56px. Content pads 16px at the sides and 18px on top. There is no sidebar, no page head and no skyline.

**Public.** Full-width bands that meet edge to edge, with text on a 16px margin that becomes 40px at 760px. Section rhythm is fluid (`clamp(56px, 8vw, 120px)` is typical). Grids are asymmetric: 5/7, 1/2 and a 12-column split. Text holds to 30 to 46ch inside the wide bands. The footer is a tile board with 6 to 8px gutters on a 12-column grid.

**Storeys.** From 860px wide and 720px tall, feature storeys fill the viewport below the header and stick, with 40svh of empty scroll between them so each one holds before the next slides over. Below that they stack as normal sections.

**Dutch first.** Layouts have to survive the longer Dutch strings; the page head moves actions onto their own row rather than wrap the title.

## Elevation & Depth

Flat by default, with tonal layering doing the work: sky behind white behind a single sky-tinted step. The sheet has a 1px edge and no shadow. Public bands and tiles have no shadow and no border; they are separated by colour and gutter.

### Shadow Vocabulary

- **Popover float** (`box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)`): popovers and menus.
- **Dialog float** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`): dialogs and sheets.

### Named Rules

**The Things That Float Rule.** A shadow means the thing truly floats over the page: a menu, a dialog, a sheet, a dragged row. Nothing at rest in the page carries one.

**The Solid Head Rule.** The sticky page head and the public header stand on solid colour. Do not frost them. Blur exists only to obscure a flagged image in moderation.

## Shapes

Small radii on filled shapes with real edges. Buttons, fields and nav items use 4px (`md`), cards and tab tracks 6px (`lg`), and the phone add button and public actions 10px (`xl`). The sheet's 12px corner is the largest in the frame. 16px belongs to message bubbles and the shapes that sit in a conversation. Full rounds are for things that are round by nature: avatars, unread dots and counts, sliders, and removable filter chips.

Public bands, footer tiles, shelf drawers and planks have square corners: they are parts of a building. Box covers have 2px top corners only, and stand on a ledge.

Silhouettes come from the street: the gable skyline, the small triangular pointer under a floor pin, and the triangular notch that ties the docked shelf to the chosen floor. The logo's puzzle-piece mark is the only jigsaw shape in the system.

## Components

### Buttons

Flat and direct; every pressable thing answers the finger.

- **Shape:** gently squared (4px); public actions (10px) at 42 to 54px tall.
- **Primary:** Canal Primary with white text, 36px tall, 14px at 500. Small is 32px and large 40px. On phones, default, small and icon sizes keep their look and reach 44px through an invisible hit area.
- **Marigold:** flat marigold with Canal Ink text; the `brand` variant. Public uses set it larger at 700.
- **Hover / Focus:** primary fades to 90%; marigold moves to Marigold Press. Focus is a solid 3px outline in the ink colour, offset 2px. No glow, gradient or inner highlight.
- **Secondary / Outline / Ghost / Link:** a sky-tinted fill; a white fill with a 1px edge; a hover-only sky fill; underlined Canal Link text.

### Chips

- **Style:** removable filter chips are fully round with a 1px input edge on the card colour, holding a small tinted field name. Badges are 4 to 6px with a soft status fill and strong status text.
- **State:** difficulty has a four-step fill and text scale (easy, medium, hard, expert) in both themes.

### Cards / Containers

- **Corner Style:** 6px; list tiles up to 10px.
- **Background:** Sheet on light, Night Card on dark.
- **Shadow Strategy:** none at rest; see Elevation & Depth.
- **Border:** 1px Line.
- **Internal Padding:** 24px.

### Inputs / Fields

- **Style:** 36px tall, 1px Line Input, 4px radius, transparent fill.
- **Focus:** border moves to the ring colour with a 3px ring at 50%.
- **Error / Disabled:** a destructive border and soft ring; 50% opacity.
- **Search trigger:** a flat 32px field in the top bar, centred on the window, that opens the command palette.

### Navigation

- **Sidebar:** serif group names that link to their landing, underlined when current. Items are 14px with an icon. Hover is Frame Step. The active item is a white window in the frame, at 600: not a tinted pill.
- **Top bar:** sidebar toggle and logo, centred search, then bell, theme and language, then Add Puzzle in marigold. No avatar; identity sits at the foot of the sidebar.
- **Tab bar:** four tabs on the card colour with a raised 52px marigold button in the centre that opens the quick-action sheet. The current tab fills its icon and turns its label to 600.
- **Public header:** sticky on sky, 64px; text links at 16px, underlined when current or hovered; collapses into a white menu below 1200px, where the longest bar (Dutch, signed out) still fits on one line.

### Gable Skyline

The signature that signs the app and the public footer, and closes the Features page: twelve flat facades (stepped, bell and neck gables, pitched houses, a church spire, a windmill) in one colour at 480 by 120, with window rectangles painted from `--skyline-window`. At the foot of the sidebar it is tone on tone, its windows invisible by day and lit in dimmed marigold at night, behind the account row; it appears only from 720px of height. In the footer it stands on canal and its windows are lit marigold in both themes.

### Floor Pins and Shelf Drawer

The hero's interaction. Three pins with a triangular pointer stand on the cutaway house, Canal Ink at rest and marigold when chosen. The chosen floor stays clear while a flat canal dim, masked to the art's own edge, falls over the rest; its shelf docks beside the house in a white drawer. Each box stands on a 9px plank, its width following its piece count.

### Lending Slip

A white ledger on the canal storey: 16px tabular text, dotted leaders between the thing and the person, and a closing canal line at 700. Used to explain how lending works; it is a how-it-works device, not a general table style.

### Curtain Footer

The back of the street: a board of filled tiles (sky, sky soft, plank), then the name at the full width of the street over a canal band and skyline. The opaque page slides up to uncover it through sticky positioning alone, and only where the board fits the viewport (from 1024px wide and 700px tall, or 640px wide and 1120px tall). Keyboard focus into it scrolls it clear.

### Motion

- **Press:** `scale(0.97)` under `motion-safe`, on buttons, nav items, tabs and public links, over 150 to 160ms.
- **Easing:** strong ease-out, `cubic-bezier(0.23, 1, 0.32, 1)`, everywhere motion is used.
- **Keyboard:** no animation on keyboard-driven actions. The command palette and its backdrop open and close instantly, the sidebar toggle has no transition, and an instant tooltip does not animate.
- **Overlays:** popovers, menus, selects and tooltips scale from 95% at their trigger's origin. Dialogs scale from their centre over 200ms; sheets take 280ms in and 200ms out. Everything in the shell stays under 300ms, and overlay animation is removed for reduced motion.
- **Public entrances:** once per section part, a rise of 16 to 32px over 500 to 560ms, staggered by 60 to 70ms. Content is visible by default, so nothing can get stuck hidden; reduced motion keeps the fade and drops the rise.
- **The loud moment:** the curtain footer, once per page.

## Do's and Don'ts

### Do:

- **Do** use Canal Primary for the shell's everyday primary, and marigold only for Add Puzzle in the top bar and the phone add button.
- **Do** keep marigold's text in Canal Ink, and give every Persuade page one clear marigold action.
- **Do** set figures in the app in Hanken Grotesk with tabular numerals.
- **Do** build hierarchy on Young Serif by size alone, at its one weight.
- **Do** stand boxes on a plank ledge, and let bands and tiles meet with colour rather than borders or shadows.
- **Do** use the wordmark's own colour tokens, with the night pair after dark.
- **Do** give every pressable thing the 0.97 press under `motion-safe`, and keep shell motion under 300ms.
- **Do** make dark mode the same street at night, above black, with lit windows.
- **Do** ship new marketing rasters with a provenance record beside the file.

### Don't:

- **Don't** put a real third-party box cover on JigSwap's own marketing; those covers are catalogue content only.
- **Don't** use a jigsaw-piece shape as decoration; the logo mark is the one puzzle piece in the world.
- **Don't** add a second marigold button to a shell screen, or use marigold for an everyday action.
- **Don't** write `font-bold` or `font-semibold` on Young Serif, or use it for data figures in the app.
- **Don't** use Baloo 2 for anything but the wordmark.
- **Don't** use tinted pill navigation, frosted page heads, uppercase captions, greeting emoji or glowing action buttons in the shell.
- **Don't** use a centred hero with three feature cards on public pages.
- **Don't** animate keyboard-driven or high-frequency actions.
- **Don't** add decorative gradients; a scrim is for keeping text legible on a photo.
- **Don't** add invented testimonials, press logos or inflated counts as visual proof.

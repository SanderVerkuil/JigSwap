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
  destructive-text: "#c10007"
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
  night-destructive-text: "#ffb0ab"
  night-plank: "#8a6a3b"
  night-logo-jig: "#a79cf7"
  night-logo-swap: "#4fd14c"
typography:
  display-hero:
    fontFamily: "Young Serif, Georgia, Times New Roman, serif"
    fontSize: "min(calc((100cqw - 80px) / 10.2), 15svh)" # 15svh cap; 13svh and 11svh on short screens, see Display Hero
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
- **Canal Ink** (#0f3b30): all text on light grounds, ink on marigold, the canal storey (public, and the app home's briefing band) and the public floor pins.
- **Canal Link** (#146350): primary as text on page surfaces (links, chips, icons) and the focus ring colour of inputs.
- **Primary Tint** (`color-mix(in oklab, Canal Link 12%, Sky Frame)`, about #cbdfe4): the picked and selected fill, a canal-sky step below the hover sky and never a grey. Canal Link text on it is 5.2:1 and Ink Muted 4.6:1. After dark it is Night Primary at 22% in Night Card.

### Secondary

- **Marigold** (#ffb81c) with **Marigold Press** (#f4a900) on hover: the main action on public pages; Add Puzzle and the phone add button in the shell. Text on it is always Canal Ink, at 7.18:1.
- **Sky** (#b4dcf8): the public field: header, with the phone Docs bar that sticks under it as one head storey, hero, page heroes and the closing call to action. By day it is also the hover step of a Sky Soft tile (the docs pager); after dark that tile steps from Night Raised to Night Accent.
- **Sky Soft** (#dceffc): the quieter public band, footer tiles and the quiet boxes of long documents. After dark those boxes take Night Raised, because Sky Soft's own night value is the page ground. Something chosen inside a Sky Soft box is a white window (Night Card after dark).
- **Sky Frame** (#e3f1fa) with **Frame Step** (#cfe6f5) and **Frame Line** (#cbe0ec): the shell's L-frame, its hover step and its edge. Frame Step is also the tone-on-tone skyline. The browser `theme-color` and the manifest use Sky Frame.

### Tertiary

- **Plank** (#e4c79a): ledges that boxes stand on, the 3D shelf's board (flat, matte, no grain) and the legal footer tile.
- **Tulip** (#c8321f): unread dots and counts. An unread notification carries its dot in the row's left gutter, level with the avatar, and its hover is the full Sky Frame accent step, past the unread tint. Chart colours reuse it, Canal Link and three chart-only tones.
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
- **Night Destructive Text** (#ffb0ab, `--destructive-text`): destructive as text only, at least 4.5:1 on the card, the accent and a focused destructive menu row. Every `text-destructive` reads it through `--text-color-destructive`; fills, borders and rings keep `--destructive`, and white on `bg-destructive/60` stays 4.67:1. By day it is **Destructive Text** (#c10007), deeper than the fill: 6.42:1 on the sheet, 5.40:1 on a focused destructive menu row, and at least 4.5:1 on the accent, muted, secondary and Primary Tint fills. Clerk's `colorDanger` reads this token too. Its solid danger button (Remove, Delete account) therefore fills with it, so that label takes the sheet colour: white on the day red at 6.42:1, and Night Sheet ink on the night rose at 7.58:1.

### Named Rules

**The Reserved Marigold Rule.** In the shell, marigold is an action colour for Add Puzzle in the top bar and the phone add button, and for nothing else that can be pressed. Everyday primaries are canal green. Its only other shell appearances are non-action marks: rating stars, text selection, and the night skyline's windows.

**The Public Marigold Rule.** On public pages marigold marks the main action. The hero extends it to the things that act on that same promise: each "ask to borrow" button in the docked shelf, and the chosen floor pin. A long page may also carry one full marigold storey (Discover on home, its counterpart on Features). The closing call to action stays a marigold button on sky, not a marigold band. Two recorded exceptions: the public header's **Start your shelf** is canal, because the page's marigold copy sits in the hero (the bar's copy steps aside while the hero's is in view; see Navigation), and About's main action, **Get in touch**, is canal.

**The Logo's Own Colours Rule.** The wordmark takes `logo-jig` and `logo-swap`, and the violet raster mark stays as drawn, whatever the theme's primary does. The pair has a lifted night version for legibility. The single exception is the footer's giant name, knocked out in one light colour because the two-tone logo turns garish at that size on ink.

**The Night Street Rule.** Dark mode keeps the street's hues and stays clearly above black: nothing in the theme goes below Night Canal (OKLCH lightness 0.23), and working surfaces start at Night Sheet (0.31). Black appears only as a translucent scrim over content.

## Typography

**Display Font:** Young Serif (with Georgia, Times New Roman, serif)
**Body Font:** Hanken Grotesk (with ui-sans-serif, system-ui, sans-serif)
**Label/Mono Font:** Baloo 2 for the logo's wordmark only. Technical strings use the system monospace stack.

**Character:** A sturdy, slightly old-fashioned serif, like painted lettering on a canal house, over a plain warm grotesque that stays out of the way of names and numbers. Atkinson Hyperlegible was tried for the text role and rejected: its slashed zeros misread piece counts.

### Hierarchy

- **Display Hero** (400, scaled so the line fills the measure, 1): the home h1, on one line from 760px, in the sky, balanced over two lines only when a reader's text spacing needs it. Capped at 15svh, and at 13svh on screens up to 800px tall; from 1180px wide the cap is 13svh up to 880px tall and 11svh up to 800px tall, so the lowest floor name stays on the first screen.
- **Display Page** (400, `clamp(38px, 6vw, 104px)`, 1.03): public sub-page titles.
- **Headline Section** (400, `clamp(32px, 4.4vw, 68px)`, 1.06): public section statements. The How preview starts at 40px; Sustain runs `clamp(30px, 3.6vw, 52px)`.
- **Title Storey** (400, `clamp(28px, 3vw, 44px)`, 1; 22px on phones): the band title of a feature storey.
- **Statement** (400, `clamp(24px, 2.5vw, 36px)`, 1.3): the family's quote and the live-count sentence.
- **Title Page** (400, 1.5rem): page titles in the sheet head; 1.25rem in the phone top bar, 0.875rem below 640px, on up to two lines, hyphenated by the page language so one long Dutch word breaks rather than cuts off.
- **Title Section** (400, 1.25rem): dashboard section heads and the briefing sentence.
- **Label Group** (400, 15px): sidebar group names, in the serif.
- **Body Public** (400, 18px, 1.5; leads `clamp(18px, 1.5vw, 21px)`, measure 46ch): reading text on public pages.
- **Body App** (400, 0.875rem): all interface text; fields rise to 1rem on phones.
- **Action** (public 700, 18 to 20px; app 500, 0.875rem): button labels.
- **Label** (500, 0.75rem): tab bar labels, stat captions, badges. Sentence case.
- **Figure** (600, 1.5rem to 1.875rem, `tnum`): numbers in the app, in the text face.

### Named Rules

**The One Weight Rule.** Young Serif has one weight, 400. `font-synthesis-weight: none` on the root means a bold on it renders as regular, never as a browser-faked bold. Build hierarchy through size. Do not write a weight on the display face.

**The Figures Rule.** Figures that are data in the app use Hanken Grotesk with tabular numerals, through the `figures` utility (Hanken Grotesk, lining tabular numerals). Young Serif's old-style figures misread as data. The home page's live-count sentence is the recorded exception: there the figures are words in a public sentence, not a readout.

**The Logo Lettering Rule.** Baloo 2 at 700 sets the wordmark and nothing else.

## Layout

**Shell, from 768px.** A sky L-frame of a 48px top bar (56px on touch screens, where its controls are 44px targets) and a 16rem sidebar, with no rule between them. The sidebar starts below that bar and ends above the open cookie banner. The white sheet butts both and is inset 8px from the window's right and bottom. The page head sticks to the sheet's top on a solid ground with one quiet edge; content pads 24px and scrolls inside the sheet, passing under the head. Frame, sheet and card are the only three levels. Content is full width by default, or a centred 1180px column by preference; `/messages` is full-bleed.

**The canal storey.** The app home's briefing (the summary sentence, a waiting request and the quick actions) stands on one Canal Ink band, Night Canal after dark. It is the shell's only canal band and the recorded exception to "Frame, sheet and card are the only three levels". It starts at the page head's edge (the top bar's on phones) and its fill runs out past the content padding to the sheet's edges (up to a classic scrollbar), also with the centred column, while its text keeps the content margin. It has 24px of band above and below its text (18px on phones), so the blocks under it start that much lower. At night on phones it meets the top bar with no visible edge, so the two read as one dark storey. In forced colours it falls back to the page ground, like the public bands. On the band:

- text is On Canal;
- a link is marked by an On Canal underline at 45%;
- focus is drawn in On Canal, because Canal Link and the default ring measure 1.74:1 on canal and marigold stays reserved;
- the quick-action chips' ring sits after a 2px canal gap.

It holds only white things, like the lending slip on the public canal storey: the request slip and the quick-action chips, both Night Card after dark. Below it the sheet stays white. The rest of the home keeps the shell's quiet tones: status chips are opaque soft fills with strong text, and puzzle names that link to the puzzle are Canal Link.

**Shell, below 768px.** A dedicated phone layout rather than a squeezed one: the document scrolls, under a 56px sticky sky top bar and above a five-slot bottom tab bar of at least 56px. Content pads 16px at the sides and 18px on top. There is no sidebar, no page head and no skyline.

**Public.** Full-width bands that meet edge to edge, with text on a 16px margin that becomes 40px at 760px. Section rhythm is fluid (`clamp(56px, 8vw, 120px)` is typical). Grids are asymmetric: 5/7, 1/2 and a 12-column split. Text holds to 30 to 46ch inside the wide bands. The footer is a tile board with 6 to 8px gutters on a 12-column grid. The sticky 64px header's offset lives in one place, `html:has(.mk-root) { scroll-padding-top: 80px }`, so focus and anchor jumps stop 16px below it; targets don't add their own header margin, and docs adds its 48px bar on phones (112px).

**Public member page.** It follows the street: the hero sits on a full-bleed sky band and the closing call to action is on sky, as on home. A visitor sees only the figures that aren't zero. On the sky band, tinted chips become the street's opaque status chips (soft fill, strong text), because a 10% tint over sky drops under 4.5:1.

**Long documents.** A legal page's or docs article's contents rail is sticky, scrolls on its own and ends above the cookie banner. Below the rail's breakpoint the list folds into a details block under the title: at 900px for legal, with a **Back to contents** link after each section; at 1280px for docs. Docs gets an **On this page** jump in the phone Docs bar below 861px, and at the top of the sticky sidebar from 861 to 1279px. The highlighted entry is the last section whose top is within 140px of the top of the window; a section picked from the list stays highlighted until the reader scrolls back up or it leaves the window. Anchors land 16px below the sticky chrome through the page's scroll padding. A docs article is at most 620px wide. Its text size follows the article's own width, not the window's: once the article is 600px wide, which beside the sidebar is from about 984px, its text is 18px with a 1.65 line height, about 71 characters a line. A narrower article keeps 17px with a 1.75 line height: at most 576px (36rem) below 861px, about 71, and 484 to 600px beside the sidebar from 861px, about 59 to 74. Long documents stay calm so they're easy to read: running text and the docs landing's topic list sit on the page ground (Sheet, Night Sheet after dark), with no bands. Their quiet boxes are Sky Soft (Night Raised after dark): the folded contents, the docs pager tiles, **Was this page helpful?**, collapsible answers, info notes, step numbers, code blocks, table heads and the docs landing's topic icons. Open answers and notes are the only running text on a tint. Inline code stays Surface Muted (a canal tint after dark). A current entry inside a fold is a white window (Night Card after dark); in the sticky rail and the docs sidebar it is a Sky Soft pill (Night Raised).

**Storeys.** From 860px wide and 720px tall, feature storeys fill the viewport below the header and stick, with 12svh of empty scroll between them so each one holds before the next slides over. Below that they stack as normal sections.

**Dutch first.** Layouts have to survive the longer Dutch strings; the page head moves actions onto their own row rather than wrap the title.

## Elevation & Depth

Flat by default, with tonal layering doing the work: sky behind white behind a single sky-tinted step. The sheet has a 1px edge and no shadow. Public bands and tiles have no shadow and no border; they are separated by colour and gutter.

### Shadow Vocabulary

- **Popover float** (`box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)`): popovers and menus. Turned upward (`0 -4px 6px -1px rgb(0 0 0 / 0.1), 0 -2px 4px -2px rgb(0 0 0 / 0.1)`) on the cookie banner.
- **Dialog float** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`): dialogs and sheets.

### Cookie Banner

A floating bar over the page's foot: a 1px Line top edge (`border-t border-border`) and the upward Popover float, with its text on the 40px margin from 640px and its buttons at the right edge. While it is open it publishes the strip of the window it covers above the phone tab bar as `--consent-banner-height` (its height, plus its gap over the bar on phones; unset when closed). Public pages pad the document's end by it, and `html` scroll padding keeps focus clear of it and the phone tab bar. The shell pads the end of its own scroll region instead, at every width, so the phone tab bar stays at the bottom; from 768px that is also scroll padding, and the desktop sidebar ends above the banner.

### Named Rules

**The Things That Float Rule.** A shadow means the thing truly floats over the page: a menu, a dialog, a sheet, a dragged row, the cookie banner. Nothing at rest in the page carries one.

**The Solid Head Rule.** The sticky page head and the public header stand on solid colour. Do not frost them. Blur exists only to obscure a flagged image in moderation.

## Shapes

Small radii on filled shapes with real edges. Buttons, fields and nav items use 4px (`md`), cards and tab tracks 6px (`lg`), and the phone add button and public actions 10px (`xl`). The sheet's 12px corner is the largest in the frame. 16px belongs to message bubbles and the shapes that sit in a conversation. Full rounds are for things that are round by nature: avatars, unread dots and counts, sliders, and removable filter chips.

Public bands, footer tiles, shelf drawers and planks have square corners: they are parts of a building. Box covers have 2px top corners only, and stand on a ledge.

Silhouettes come from the street: the gable skyline, the small triangular pointer under a floor pin, and the triangular notch that ties the docked shelf to the chosen floor. The logo's puzzle-piece mark is the only jigsaw shape in the system.

## Components

### Buttons

Flat and direct; every pressable thing answers the finger.

- **Shape:** gently squared (4px); public actions (10px) at 42 to 54px tall. A public action whose label is wider than a narrow phone wraps to two lines instead of running off the screen, and stays at least 50px tall, on touch too.
- **Primary:** Canal Primary with white text, 36px tall, 14px at 500. Small is 32px and large 40px. On phones, default, small and icon sizes keep their look and reach 44px through an invisible hit area.
- **Public size** (`size="public"`): 50px tall, 10px radius, 18px at 700, 22px side padding (20px with an icon), still reaching 44px on touch. Public page actions use it: Features, How it works, the public catalogue and member pages, the Contact submit, About's **Get in touch** and the marketing 404.
- **Marigold:** flat marigold with Canal Ink text; the `brand` variant. Public uses set it larger at 700.
- **Hover / Focus:** primary fades to 90%; marigold moves to Marigold Press. Focus is a solid 3px outline in the ink colour, offset 2px. No glow, gradient or inner highlight.
- **Secondary / Outline / Ghost / Link:** a sky-tinted fill; a white fill with a 1px edge; a hover-only sky fill; underlined Canal Link text.

### Chips

- **Style:** removable filter chips are fully round with a 1px input edge on the card colour, holding a small tinted field name. Badges are 4 to 6px with a soft status fill and strong status text.
- **State:** difficulty has a four-step fill and text scale (easy, medium, hard, expert) in both themes. The Insights By difficulty chart uses the same scale, with each step's strong tone as the fill and an Ink Muted tint (muted-foreground at 60%) for Unknown; every fill is at least 2:1 against the page in both themes.
- **Chosen:** the contact subject chip is a Canal fill with white text by day, and a Night Link fill with Night Canal text after dark.

### Selection

- **Filters:** single-choice filters (FilterBar on Trades, My Puzzles, Messages, Household and the member page, the household owner filter, and the /notifications and /whats-new categories) sit in the tab track: Surface Muted, 6px corners and 3px padding. The options are flat 4px items, and the chosen one is a white window at 600 with a 1px inset Canal Link edge (Night Link after dark), inset so it never thins the 2px focus ring; white on the track alone is too faint to show the choice. A filter's chosen option is never a canal fill, which would read as an action.
- **Form choices:** radio groups in forms (SegmentedPills) keep the canal fill, with 4px corners and a 1px Night Link ring after dark (Night Primary alone is under 3:1 on the sheet).
- **Picked:** a picked or selected choice (piece-count presets, picked catalogue rows) carries the Primary Tint plus a 1px Canal Link edge, and toggles expose `aria-pressed`: never a fill alone.

### Cards / Containers

- **Corner Style:** 6px; list tiles up to 10px.
- **Background:** Sheet on light, Night Card on dark.
- **Shadow Strategy:** none at rest; see Elevation & Depth.
- **Border:** 1px Line.
- **Internal Padding:** 24px.

### Inputs / Fields

- **Style:** 36px tall, 1px Line Input, 4px radius, transparent fill.
- **Focus:** border moves to the ring colour with a 3px ring at 50%.
- **Error / Disabled:** a destructive border and soft ring; 50% opacity. A field check runs when the member leaves the field and shows one 14px destructive line under it, linked with `aria-describedby`. An error on the Primary Tint (the import zone) is a destructive icon with the words in the foreground colour.
- **Tag field:** drawn like Input (36px, 4px radius, Line Input edge, transparent fill, the same focus); its tags are removable chips inside it.
- **Search trigger:** a flat 32px field in the top bar, centred on the window, that opens the command palette.
- **Switch:** the unchecked track has a 1px Ink Muted edge by day (6.3:1 on white) and none at night; on keyboard focus the edge takes the ring colour.

### Navigation

- **Sidebar:** serif group names that link to their landing, underlined when current. Items are 14px with an icon. Hover is Frame Step. The active item is a white window in the frame, at 600: not a tinted pill.
- **Top bar:** sidebar toggle and logo, centred search, then bell, theme and language, then Add Puzzle in marigold. No avatar; identity sits at the foot of the sidebar. 48px, or 56px on a touch screen so its 44px targets and the bell's badge fit inside it.
- **Tab bar:** four tabs on the card colour with a raised 52px marigold button in the centre that opens the quick-action sheet. The current tab fills its icon and turns its label to 600.
- **Public header:** sticky on sky, 64px; text links at 16px, underlined on the current section and the pages under it (a docs article underlines Docs), or when hovered; collapses into a white menu below 1200px, where the longest bar (Dutch, signed out) still fits on one line. Tabbing past the open menu closes it.
- **Public header action:** the bar's canal **Start your shelf** keeps its place at all times. On home, Features and How it works it fades out and drops 4px while the hero's own marigold copy is in view (opacity, visibility and translate over 200ms; under reduced motion it swaps at once with no drop), and its slot stays empty, so the links never move. In view means between the bar and the open cookie banner: on a phone the banner covers home's hero action, so there the bar keeps its action until the hero's shows above the banner. Moving to one of these pages starts with the bar's action away, as a fresh load does.
- **Tabs:** underline tabs mark the active tab with a 2px Canal Primary underline, Night Link after dark.

### Menus, Palette and Toasts

- **Keyboard row:** in menus, selects and the command palette, the row the keyboard is on carries a 2px inset `--ring` outline as well as the accent tint (the tint alone is 1.15:1). In the palette it follows cmdk's selection, so hover shows it too.
- **Command palette:** anchored 12vh from the top (16px below 768px and in windows under 500px tall), not centred, so only its list grows as results change.
- **Toasts:** the action is a primary button and the cancel a secondary one, the description is muted text, the buttons take the app's 2px focus ring with a 2px offset, and the toast has the 6px card radius.
- **Account menu:** Clerk's menu rows are opaque Ink Muted, 36px for a mouse and 44px on touch, and the menu scrolls inside itself when it is taller than the window minus 140px. What's new is in the phone's menu only; on desktop it is the sidebar row above the account. Without a photo, the menu header shows the same canal initial disc as the trigger.

### Avatars

A member without a photo shows their initial, white on Canal Primary, on every surface; Clerk's generated default picture is never drawn. The profile header's large tinted initial is the one exception.

### System States

- **Offline notice:** after 3 seconds without a connection, a slim Surface Muted strip with 14px Ink Muted text and a wifi-off icon says the member is offline. It sits at the top of the sheet from 768px and inside the sticky phone top bar, and goes as soon as the connection is back. A message still on its way shows **Sending…** (or **Waiting for connection** while offline) in its time's place, and the member's own presence dot hides while offline.
- **Error card:** the route error card offers Try again, Reload page and a link back to the dashboard (home for visitors). Offline, it says "You're offline" and loads the page by itself once the browser is back online; a page whose code didn't arrive offline shows this card instead of the browser's offline screen, and no "new version" prompt appears.
- **Not found in the shell:** the page head carries "Page not found" (or the name of what's missing) as the page title, with no subtitle and no breadcrumb. The content shows one muted body-app line and the ways back: an outline **Back to …** button, or, for the generic 404, the primary **Back to dashboard** plus a **Browse puzzles** link. No display headline and no second h1; the display-size headline belongs only to the public 404 and the router default. One exception: on an open thread's path (`/messages/<id>`) the phone has no top bar, so below 768px the not-found shows its title as a 24px serif h1 above the line. Known limitation: an unknown shell path's server HTML shows the route's own head title until hydration publishes "Page not found".
- **No results:** a no-results state names a search by its words only when the text is all that narrows the results ("No puzzles match “…”", "Nobody offers a copy matching “…” right now"). Text searched within favourites, or within one puzzle's copies, is blamed like a filter. A title that carries the member's own text wraps anywhere, so one long word can't push it off a phone screen.

### Gable Skyline

The signature that signs the app and the public footer, and closes the Features page: twelve flat facades (stepped, bell and neck gables, pitched houses, a church spire, a windmill) in one colour at 480 by 120, with window rectangles painted from `--skyline-window`. At the foot of the sidebar it is tone on tone, its windows invisible by day and lit in dimmed marigold at night, behind the account row; it appears only from 720px of height. In the footer it stands on canal, its windows lit marigold in both themes, and it runs edge to edge: five stretches at drawn size up to 2400px, growing with the band beyond that.

### Floor Pins and Shelf Drawer

The hero's interaction. Each of three floors of the cutaway house is one button, carrying a name pin with a triangular pointer, Canal Ink at rest and marigold when chosen. The floors meet mid-beam, so no click falls between them. The chosen floor stays clear while a flat canal dim, masked to the art's own edge, falls over the rest; the dim on a floor half lifts while it is pointed at or focused. The chosen floor's shelf docks beside the house in a white drawer. Each box stands on a 9px plank, its width following its piece count.

From 1180px the hero's actions stand in a column that starts right of the main gable (57% of the width), so the roof never reaches them: the marigold action, the catalogue link, then the trust line where the column is wide enough, which wraps above the action where it isn't. From 1180 to 1239px wide, and on screens up to 880px tall, the lead is 18px with a 560px measure, so it ends before the main gable's apex. Below 1180px the shelf sits under the house, and choosing a floor scrolls it into view, but never so far that the chosen name goes under the header.

### Lending Slip

A white ledger on the canal storey: 16px tabular text, dotted leaders between the thing and the person, and a closing canal line at 700. Used to explain how lending works; it is a how-it-works device, not a general table style.

### Curtain Footer

The back of the street: a board of filled tiles (sky, sky soft, plank), then the name at the full width of the street over a canal band and skyline. The board arrives with the page like any other content, so its links come first; it then slides up to uncover the name and skyline, pinned behind it through sticky positioning alone.

### Motion

- **Press:** `scale(0.97)` under `motion-safe`, on buttons, nav items, tabs and public links, over 150 to 160ms.
- **Easing:** strong ease-out, `cubic-bezier(0.23, 1, 0.32, 1)`, everywhere motion is used.
- **Keyboard:** no animation on keyboard-driven actions. The command palette and its backdrop open and close instantly, the sidebar toggle has no transition, and an instant tooltip does not animate.
- **Overlays:** popovers, menus, selects and tooltips scale from 95% at their trigger's origin. Dialogs scale from their centre over 200ms; sheets take 280ms in and 200ms out. Everything in the shell stays under 300ms, and overlay animation is removed for reduced motion.
- **Public entrances:** Reveal runs on section headings and their intro text only, never on cards, art, list rows, FAQ answers, nested rows or a closing call-to-action button: a rise of 16 to 32px over 500 to 560ms, with a stagger of at most 70ms. On the first screen, hero text and the hero action enter with ENTER at 60 and 130ms. No public picture moves on its own: no drift and no art entrance (PageHero's picture is simply there). Content is visible by default, so nothing can get stuck hidden; reduced motion keeps the fade and drops the rise.
- **The loud moment:** the curtain footer, once per page.

## Do's and Don'ts

### Do:

- **Do** use Canal Primary for the shell's everyday primary, and marigold only for Add Puzzle in the top bar and the phone add button.
- **Do** keep marigold's text in Canal Ink, and give every Persuade page one clear marigold action (About, whose main action is a canal **Get in touch**, is the recorded exception).
- **Do** set figures in the app in Hanken Grotesk with tabular numerals.
- **Do** build hierarchy on Young Serif by size alone, at its one weight.
- **Do** stand boxes on a plank ledge, and let bands and tiles meet with colour rather than borders or shadows.
- **Do** use the wordmark's own colour tokens, with the night pair after dark.
- **Do** give every pressable thing the 0.97 press under `motion-safe`, and keep shell motion under 300ms.
- **Do** make dark mode the same street at night, above black, with lit windows.
- **Do** ship new marketing rasters with a provenance record beside the file, and with smaller renditions made by resizing, not only by lowering quality, offered through `srcSet` and a `sizes` that matches the slot. Art on the first screen uses Art's `priority`, and all other art loads lazily.
- **Do** mask an effect to a picture's edge with an alpha-only file (such as `house-cut-mask.webp`), never with the picture itself.

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

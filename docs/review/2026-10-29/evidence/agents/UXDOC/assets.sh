#!/usr/bin/env bash
set -euo pipefail
T=/tmp/jigswap-review/tiles
A=/tmp/jigswap-review/agents
OUT=/home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/app-review/docs/review/2026-10-29/assets
W=/tmp/jigswap-review/agents/UXDOC/work
mkdir -p "$OUT" "$W"
# panel <tmpname> <src> <pct> <label>
panel() {
  magick "$2" -resize "$3" -background '#ececf3' -fill '#1f1f2e' -font DejaVu-Sans -pointsize 17 \
    -gravity north -splice 0x32 -annotate +0+7 "$4" -bordercolor white -border 6 "$W/$1.png"
}
# compose <out> <tmpnames...>
compose() {
  local out=$1; shift; local files=()
  for f in "$@"; do files+=("$W/$f.png"); done
  magick "${files[@]}" -background white -gravity north +append -quality 72 "$OUT/$out"
}
single() { magick "$1" -resize "$2" -quality 72 "$OUT/$3"; }
M=m9712xm5gtgnqszgq5xwvh82ph8a9hdz
DM=04e0cd32-b61f-48f9-98e1-c25d9de34c28
CIR=ec1b1833-8cae-47b3-ac3c-783e276b28c9

single $A/DISC/d_puzzles_filters_open.jpg 75% desktop-catalogue-filters-loading.jpg

panel a1 $T/desktop-light/app__messages_${DM}__01.jpg 75% "Desktop 1440"
panel a2 $T/tablet-light/app__messages_${DM}__01.jpg 75% "Tablet 820 (default)"
panel a3 $A/JOURNEY-VERIFY/t-thread-sidebar-collapsed.jpg 75% "Tablet 820, sidebar collapsed"
panel a4 $T/mobile-light/app__messages_${DM}__01.jpg 50% "Mobile 390"
compose messages-thread-desktop-tablet-mobile.jpg a1 a2 a3 a4

panel b1 $A/SOC/m-profile-edit-01.jpg 50% "Mobile: Edit Profile"
panel b2 $A/SOC/mobile-profile-edit-visibility.jpg 50% "Mobile: switch/Edit off-screen"
compose mobile-profile-edit-overflow.jpg b1 b2

panel c1 $T/desktop-light/app__notifications__01.jpg 75% "Desktop 1440"
panel c2 $T/tablet-light/app__notifications__01.jpg 75% "Tablet 820"
panel c3 $T/mobile-light/app__notifications__01.jpg 50% "Mobile 390 EN"
panel c4 $T/mobile-nl/app__notifications__01.jpg 50% "Mobile 390 NL"
compose notifications-header-desktop-tablet-mobile.jpg c1 c2 c3 c4

panel d1 $T/mobile-light/app__dashboard__01.jpg 50% "Dashboard"
panel d2 $A/ONB/mobile__welcome_with_tip.jpg 50% "/welcome footer"
panel d3 $T/mobile-light/app__messages_${CIR}__02.jpg 50% "Circle thread (scrolled)"
compose mobile-install-tip.jpg d1 d2 d3

panel e1 $T/desktop-light/pub__home__01.jpg 75% "Desktop home: hero lead"
panel e2 $T/mobile-light/pub__privacy__02.jpg 50% "Mobile privacy body"
compose marketing-muted-text.jpg e1 e2

panel f1 $T/desktop-light/pub__members_sander__01.jpg 75% "Desktop 1440"
panel f2 $T/mobile-light/pub__members_sander__01.jpg 50% "Mobile: 'Follow'"
panel f3 $T/mobile-light/pub__members_sander__03.jpg 50% "Mobile: 'Sign up free'"
compose public-member-unstyled-ctas.jpg f1 f2 f3

panel g1 $T/desktop-light/app__welcome__01.jpg 75% "Desktop 1440"
panel g2 $T/tablet-light/app__welcome__01.jpg 75% "Tablet 820"
panel g3 $T/mobile-light/app__welcome__01.jpg 50% "Mobile 390"
compose welcome-continue-desktop-tablet-mobile.jpg g1 g2 g3

panel h1 $T/desktop-light/app__dashboard__02.jpg 75% "Desktop 1440"
panel h2 $T/tablet-light/app__dashboard__01.jpg 75% "Tablet 820"
panel h3 $T/mobile-light/app__dashboard__02.jpg 50% "Mobile 390"
compose dashboard-shelf-desktop-tablet-mobile.jpg h1 h2 h3

single $T/desktop-light/app__my-puzzles_add_new_puzzleId_${M}__01.jpg 75% desktop-add-copy-form.jpg

panel i1 $T/desktop-light/app__browse__01.jpg 75% "Desktop /browse"
panel i2 $T/mobile-light/app__browse__02.jpg 50% "Mobile /browse"
compose browse-card-actions.jpg i1 i2

single $T/desktop-light/app__puzzles__01.jpg 75% desktop-catalogue-two-add-buttons.jpg

panel j1 $T/mobile-light/app__puzzles__01.jpg 50% "/puzzles"
panel j2 $T/mobile-light/app__my-puzzles__01.jpg 50% "/my-puzzles"
panel j3 $T/mobile-light/app__household__02.jpg 50% "/household"
compose mobile-one-card-grids.jpg j1 j2 j3

single $T/desktop-light/app__puzzles_${M}__01.jpg 75% desktop-puzzle-detail.jpg

panel k1 $T/desktop-light/app__members_sander__01.jpg 75% "Desktop 1440"
panel k2 $T/tablet-light/app__members_sander__01.jpg 75% "Tablet 820"
panel k3 $T/mobile-light/app__members_sander__01.jpg 50% "Mobile 390"
compose member-profile-desktop-tablet-mobile.jpg k1 k2 k3

panel l1 $T/mobile-light/app__profile__01.jpg 50% "Mobile EN"
panel l2 $T/mobile-nl/app__profile__01.jpg 50% "Mobile NL"
compose mobile-profile-name-overlap.jpg l1 l2

panel m1 $T/desktop-light/app__notifications_preferences__02.jpg 75% "Desktop: aside over matrix"
panel m2 $T/mobile-light/app__notifications_preferences__02.jpg 50% "Mobile: no column headers"
compose notification-preferences-desktop-mobile.jpg m1 m2

panel n1 $A/SHARE/m_en_trades_mockrows.jpg 50% "DOM mock, EN"
panel n2 $A/SHARE/m_nl_trades_mockrows.jpg 50% "DOM mock, NL"
compose mobile-exchange-rows-en-nl.jpg n1 n2

panel o1 $T/mobile-light/app__insights__01.jpg 50% "Mobile: toggle clipped"
panel o2 $T/desktop-light/app__insights__02.jpg 75% "Desktop: donut, no legend"
compose insights-mobile-toggle-desktop-donut.jpg o1 o2

panel p1 $T/mobile-light/app__community__01.jpg 50% "Community tab"
panel p2 $T/mobile-light/app__library__01.jpg 50% "Library tab"
compose mobile-hubs-and-tab-bar.jpg p1 p2

panel q1 $T/tablet-light/pub__catalog_${M}__01.jpg 75% "Tablet 820"
panel q2 $T/mobile-nl/pub__catalog_${M}__01.jpg 50% "Mobile NL"
compose public-catalogue-detail-tablet-nl.jpg q1 q2

panel r1 $T/desktop-light/pub__sign-in__01.jpg 75% "Desktop /sign-in"
panel r2 $T/mobile-light/pub__sign-in__01.jpg 50% "Mobile /sign-in"
compose auth-pages-desktop-mobile.jpg r1 r2

panel s1 $A/SHELL/d_palette_empty.jpg 75% "Empty input: Go To list"
panel s2 $A/SHELL/d_palette_messages.jpg 75% "Typed 'messages'"
compose desktop-palette-jump-to-lost.jpg s1 s2

single $T/mobile-nl/app__puzzles_${M}_suggest-edit__03.jpg 50% mobile-nl-suggest-edit-clipped.jpg
single $T/mobile-nl/app__dashboard__01.jpg 50% mobile-nl-dashboard-title-case.jpg
single $A/ADMIN/mock-mobile-categoriesNL.jpg 50% admin-categories-nl-replica.jpg
single $T/first-visit/mobile__cookie-banner.jpg 50% mobile-cookie-banner.jpg
single $A/LIB/m-copy-owner-01.jpg 50% mobile-copy-owner-actions.jpg

panel t1 $T/desktop-dark/app__dashboard__01.jpg 75% "Desktop dark /dashboard"
panel t2 $T/mobile-dark/pub__home__01.jpg 50% "Mobile dark /"
compose dark-mode-desktop-mobile.jpg t1 t2
ls -la "$OUT" | wc -l; du -sh "$OUT"

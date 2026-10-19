# Circle chat identity

Date: 2026-10-19. Status: implemented. Authors: UX Architect (where and how), UI Designer (visuals), Project Shepherd.

## Problem

A circle group chat named "Test" looked like a DM with a person called Test. The inbox row and header
avatar showed one full-size member avatar whenever the circle had one other member, and several sentences
named the circle where a person's name would go ("New message from Test", "Write to Test…", "Message Test").

## Signals

Three signals, used the same way everywhere:

- **S1 Circle mark.** A lucide `Users` glyph on a violet disc (`bg-accent text-primary-text`). It is the
  circle's icon in the New menu already. Every circle avatar contains it, so no circle avatar is a lone person.
- **S2 Group word.** "Circle chat" / "Kringchat" (`messages.circle.circleChat`), visible where there is room,
  sr-only where there isn't.
- **S3 "your circle {name}" / "je kring {name}"** in every sentence that names the circle.

## Surfaces

| Surface                                                | Change                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Avatar (`CircleThreadAvatar`, inbox 40px, header 36px) | 0 previewed members: full-size circle mark, glyph 45%. 1+ members: the most recent other member top-left at 70%, the circle mark bottom-right at 70% **in front** (`z-[1]`, `ring-card ring-2`, glyph 55%). The second member avatar is dropped: member count doesn't change the avatar. Circle rows keep no presence dot (the corner is the mark). |
| Inbox row                                              | No visible chrome. sr-only "Circle chat: " before the title.                                                                                                                                                                                                                                                                                        |
| Thread header                                          | Second line "Circle chat · 6 members · 2 online": an `aria-hidden` prefix beside the members button; only the button truncates. Heading gets an sr-only ", Circle chat".                                                                                                                                                                            |
| Composer                                               | Placeholder "Write to your circle {circle}…"; aria-label "Message your circle {circle}" (new `label` prop). A circle thread no longer passes its name as `recipientName`.                                                                                                                                                                           |
| Location picker                                        | Exact-location warning in a circle: "Everyone in {circle} will see exactly where you are now."                                                                                                                                                                                                                                                      |
| In-app toast                                           | "New message in your circle {circle}" (`notifications.newCircleMessageToast`).                                                                                                                                                                                                                                                                      |
| Notification list                                      | `circle_message_received` icon is `Users` (badge and channel matrix; category colour unchanged). Sentence "Bas wrote in your circle **Test**."                                                                                                                                                                                                      |
| Push (English only, by design)                         | Title "Circle: {name}" (prefix first so it survives OS truncation), fallback "New circle messages". Body unchanged.                                                                                                                                                                                                                                 |
| Email digest                                           | richBody "There are new messages in your circle {circleName}." / "…in je kring {circleName}."                                                                                                                                                                                                                                                       |

Unchanged on purpose: per-run author avatar and name (already sender attribution), live-region
announcement, typing line, document title. Follow-up: the New-menu circle picker now shows the full-size
circle mark (`CircleThreadAvatar` with no members) instead of a grey disc.

## Edge cases

- Only you left: full circle mark, "Circle chat · 1 member".
- Anonymous or departed previewed member: grey `UserRound` disc behind the violet circle mark; still reads as a group.
- Long names: the title truncates; no signal depends on it. Phone (375px): the header prefix never truncates,
  the online count does first.

## Non-goals

Circle images, push localisation, deep-linking a push to its thread, a new Badge component, restyling DM or
exchange rows.

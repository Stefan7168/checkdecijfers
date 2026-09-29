// WP-LOOK part (a) round 2 (session 143, 2026-09-29, ADR 063).
//
// The chart card's ONE action row — Bewerken · Download · Insluiten · Delen ·
// Inzichten (the owner's five, open-questions #346) — must stay one row at
// every width the card is shown at: the right-hand dock with the chat list
// open (~430 px), the dock with it closed (~510 px), the in-flow card on a
// phone (~260 px). Round 1 let it wrap (two lines with the chat list open,
// three on a phone) — the owner's first change request.
//
// Mechanism (cheapest viable, CLAUDE.md conventions — no JS, no resize
// observer): the row is a CSS container (`@container` on the row itself),
// and the word next to each icon collapses to a screen-reader-only span in
// tiers driven by the ROW's width, never the viewport's:
//
//   ≥ 32rem (512 px)  all five words shown — measured: ~500 px of buttons
//                     and gaps in Dutch, the longer language.
//   < 32rem           Download · Insluiten · Delen keep only their icon
//                     (+ `title` on hover); Bewerken and Inzichten keep
//                     their word — the primary and the "something exciting"
//                     button are the two the owner named first.
//   < 20rem (320 px)  Inzichten keeps only its wand, the row's gap tightens
//                     to 6 px and Bewerken drops its pencil — the phone card's
//                     inner width is ~245-260 px (375/390 px phones): a
//                     text-only Bewerken (~83 px) + four icon buttons at 8 px
//                     side padding (~30 px each, +4 px for the Inzichten
//                     ring) + four gaps = ~231 px. Measured in the harness;
//                     anything wider wraps on a 375 px phone.
//
// The accessible NAME never changes (`sr-only`, not removed), so every
// `getByRole('button', { name })` in the tests and the e2e smoke resolves
// exactly as before. The strings below are the Tailwind classes; they live
// here, in ONE place, so the tiers cannot drift between the five buttons.
// (Tailwind v4 generates a class only when it sees the literal string in a
// scanned source file — this file is one.)

/** Download · Insluiten · Delen: icon-only below the 32rem row width. */
export const UTILITY_ACTION_LABEL_CLASS = '@max-lg:sr-only';

/** Inzichten: icon-only below the 20rem row width (phone card). */
export const INSIGHTS_ACTION_LABEL_CLASS = '@max-xs:sr-only';

/** Download · Insluiten · Delen: tighter side padding while icon-only. */
export const UTILITY_ACTION_BUTTON_CLASS = '@max-lg:px-2';

/** Inzichten: tighter side padding while icon-only. */
export const INSIGHTS_ACTION_BUTTON_CLASS = '@max-xs:px-2';

/** Bewerken keeps its word always; on the phone card it drops the pencil. */
export const EDIT_ACTION_ICON_CLASS = '@max-xs:hidden';

/** The row itself: a CSS container, gap tightens on the phone card. */
export const ACTION_ROW_CLASS = '@container mt-3 flex flex-wrap items-center gap-2 @max-xs:gap-1.5';

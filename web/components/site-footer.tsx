'use client';
// The ONE site-wide footer (docs/10-ux-design-brief.md section 3, ADR 033 D6),
// mounted globally in app/layout.tsx. Plain text, one line:
//   - the #99 attribution sentence (byte-pinned in the tests — owner copy);
//   - on the home page only, the "Over dit project" anchor to the workspace's
//     on-page section (it exists nowhere else, so elsewhere the link would be
//     dead — D6: no dead links);
//   - one gear-icon link to the internal /systeemoverzicht page (mirrors the
//     gear-icon footer entry point on the owner's other project).
// Until 2026-09-03 the workspace ALSO rendered its own footer with the same
// sentence directly above this one — two footer bars on the logged-in page
// (owner report, session 71). The workspace footer is gone; this is the only
// one. /privacy and /over still don't exist (#14(d)).
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The attribution sentence without the trailing separator. */
export const FOOTER_ATTRIBUTION =
  'Cijfers: CBS StatLine (CC BY 4.0) · Elk getal herleidbaar tot een officiële CBS-tabel';
/** The exact footer prefix on the home page (ADR 033 D6, byte-pinned in the
 * tests; owner gave the final look at PR review). */
export const FOOTER_PREFIX = FOOTER_ATTRIBUTION + ' · ';
export const FOOTER_ABOUT_LABEL = 'Over dit project';

export function SiteFooter() {
  const pathname = usePathname();
  const onHome = pathname === '/';
  return (
    <footer className="flex items-center justify-between gap-3 border-t border-line px-4 py-4 text-xs text-ink-muted">
      <span>
        {onHome ? FOOTER_PREFIX : FOOTER_ATTRIBUTION}
        {onHome ? (
          <a href="#over-dit-project" className="underline">
            {FOOTER_ABOUT_LABEL}
          </a>
        ) : null}
      </span>
      <Link
        href="/systeemoverzicht"
        aria-label="Systeemoverzicht"
        title="Systeemoverzicht"
        className="shrink-0 text-ink-muted hover:text-ink"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <rect
              key={angle}
              x="10.5"
              y="1.5"
              width="3"
              height="4"
              rx="1"
              fill="currentColor"
              transform={`rotate(${angle} 12 12)`}
            />
          ))}
          <circle cx="12" cy="12" r="6.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <circle cx="12" cy="12" r="2.4" fill="currentColor" />
        </svg>
      </Link>
    </footer>
  );
}

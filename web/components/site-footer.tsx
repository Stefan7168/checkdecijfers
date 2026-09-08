'use client';
// The ONE site-wide footer (docs/10-ux-design-brief.md section 3, ADR 033 D6),
// mounted globally in app/layout.tsx. Plain text, one line:
//   - the #99 attribution sentence (byte-pinned in the tests — owner copy);
//   - on the home page, the "Over dit project" anchor to the on-page section
//     — rendered ONLY while that section actually exists in the document
//     (D6: no dead links). Since the session-87 redesign the logged-in chat
//     screen no longer has the section (spec: bare chat, no explanatory
//     copy); the logged-out Landing still does. The footer can't know which
//     of the two '/' renders, so it checks for the anchor target itself.
//   - one gear-icon link to the internal /systeemoverzicht page (mirrors the
//     gear-icon footer entry point on the owner's other project).
// Until 2026-09-03 the workspace ALSO rendered its own footer with the same
// sentence directly above this one — two footer bars on the logged-in page
// (owner report, session 71). The workspace footer is gone; this is the only
// one. /privacy and /over still don't exist (#14(d)).
// Session 88 (#211) also appended the chat's pre-send pricing line here via a
// PricingHintContext; session 90 moved that line back into the composer
// (directly under the input, owner request) and removed the context — the
// footer is attribution (+ the home-page anchor, + the gear link) only.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/** The attribution sentence without the trailing separator. */
export const FOOTER_ATTRIBUTION =
  'Cijfers: CBS StatLine (CC BY 4.0) · Elk getal herleidbaar tot een officiële CBS-tabel';
/** The exact footer prefix on the home page (ADR 033 D6, byte-pinned in the
 * tests; owner gave the final look at PR review). */
export const FOOTER_PREFIX = FOOTER_ATTRIBUTION + ' · ';
export const FOOTER_ABOUT_LABEL = 'Over dit project';
export const ABOUT_ANCHOR_ID = 'over-dit-project';

// "Does the anchor target exist on this page?" — probed in the DOM after
// mount, so the server render and the first client render agree (no link),
// and re-probed on DOM changes while on '/' — the Landing's section can be
// committed AFTER this footer's mount effect (Suspense/streaming), and the
// probe is an O(1) id lookup that only re-renders when the answer flips.
function useAboutTargetPresent(pathname: string | null): boolean {
  const [present, setPresent] = useState(false);
  useEffect(() => {
    // A DOM probe, so it has to be an effect: the answer only exists after commit.
    const probe = () => setPresent(pathname === '/' && document.getElementById(ABOUT_ANCHOR_ID) !== null);
    probe();
    if (pathname !== '/' || typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(probe);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);
  return present;
}

export function SiteFooter() {
  const pathname = usePathname();
  const showAbout = useAboutTargetPresent(pathname);
  return (
    <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
      <span>
        {showAbout ? FOOTER_PREFIX : FOOTER_ATTRIBUTION}
        {showAbout ? (
          <a href={`#${ABOUT_ANCHOR_ID}`} className="underline underline-offset-2 hover:text-foreground">
            {FOOTER_ABOUT_LABEL}
          </a>
        ) : null}
      </span>
      <Link
        href="/systeemoverzicht"
        aria-label="Systeemoverzicht"
        title="Systeemoverzicht"
        className="shrink-0 text-muted-foreground hover:text-foreground"
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

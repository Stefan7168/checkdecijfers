// One-line site footer (docs/10-ux-design-brief.md section 3). Plain text,
// plus one icon link to the internal /systeemoverzicht page (mirrors the
// gear-icon footer entry point on the owner's other project). /privacy and
// /over still don't exist. Needs no data; safe to mount globally in
// app/layout.tsx.
import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="flex items-center justify-between gap-3 border-t border-line px-4 py-4 text-xs text-ink-muted">
      <span>Cijfers: CBS StatLine (CC BY 4.0) · Elk getal herleidbaar tot een officiële CBS-tabel</span>
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

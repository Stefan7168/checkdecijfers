// One-line site footer (docs/10-ux-design-brief.md section 3). Plain text,
// no links yet — /privacy and /over don't exist. Needs no data; safe to mount
// globally in app/layout.tsx.
export function SiteFooter() {
  return (
    <footer className="border-t border-line px-4 py-4 text-xs text-ink-muted">
      Cijfers: CBS StatLine (CC BY 4.0) · Elk getal herleidbaar tot een officiële CBS-tabel
    </footer>
  );
}

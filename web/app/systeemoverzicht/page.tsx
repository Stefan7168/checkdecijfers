// The public, noindexed system-map page (reachable via the gear icon in the
// footer, mirroring the equivalent page on the owner's other project). This
// file stays a Server Component so it can export `metadata` — the actual
// bilingual (EN default, NL second) content and its language toggle live in
// SystemMapContent, a Client Component, since `metadata` cannot be exported
// from one. No DB reads either way; safe for an anonymous visitor.
import type { Metadata } from 'next';
import { SystemMapContent } from './system-map-content.tsx';

export const metadata: Metadata = {
  title: 'System map — Check de Cijfers',
  description: 'How Check de Cijfers is built: the components, every external service, and the journey of one question.',
  // Belt-and-suspenders: the whole site is already blanket-noindexed via
  // web/app/layout.tsx + web/app/robots.ts (Phase 0, pre-launch). This page
  // should stay noindexed even after that global flag is eventually lifted —
  // it's an internal reference page, not a page meant to rank.
  robots: { index: false, follow: false },
};

export default function SystemMapPage() {
  return <SystemMapContent />;
}

'use client';
// ADR 049: the ONE place the 3D chunk is referenced. Next 16 allows
// `ssr: false` only inside a Client Component; the dynamic import puts
// `three` and the scene into a route-private chunk that no other page can
// pull in (isolation.test.ts pins this file's shape).
import dynamic from 'next/dynamic';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import type { Lang } from '../../lib/i18n/messages.ts';

const Map3d = dynamic(() => import('./map3d.tsx').then((m) => m.Map3d), {
  ssr: false,
  loading: () => <Skeleton className="h-[60vh] min-h-[420px] w-full rounded-lg" />,
});

export function Map3dLoader({ lang }: { lang: Lang }) {
  return <Map3d lang={lang} />;
}

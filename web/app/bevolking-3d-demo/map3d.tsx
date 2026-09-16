'use client';
// ADR 049: the 3D municipality DEMO. Every number rendered here is from
// fake-data.ts and sits inside an element marked data-fictional="true" —
// map3d.test.tsx walks every text node and fails on any digit outside such
// an element (or a data-year calendar label). The canvas carries an
// aria-hidden "FICTIEF" watermark so screenshots carry the label too. This
// component takes ONE prop (`lang`); it has no way to hide any label.
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { t, type Lang } from '../../lib/i18n/messages.ts';
import { useMediaQuery } from '../../lib/use-media-query.ts';
import { buildColumns, buildFloor } from './columns.ts';
import { buildFakeDataset, growthSince, populationIn, YEAR_END, YEAR_START, type FakeDataset, type FakeMunicipalityRecord, type MunicipalityType } from './fake-data.ts';
import { Legend } from './legend.tsx';
import { formatGrowth, formatPopulation, type Theme } from './scales.ts';
import { createScene, type SceneHandle } from './scene.ts';
import { areaKm2, decodeMunicipalities } from './topojson.ts';

export const TOPOJSON_URL = '/demo/gemeente_2024.topojson';
export const PLAY_INTERVAL_MS = 600;

type Status = 'loading' | 'ready' | 'unavailable' | 'failed';
type Filter = MunicipalityType | 'all';

function Details({ record, year, lang }: { record: FakeMunicipalityRecord; year: number; lang: Lang }): ReactNode {
  // `record.fictional` is typed `readonly true` and every caller sources
  // records only from buildFakeDataset, so this branch is statically
  // unreachable today (code-review note, 2026-09-15) — kept anyway as
  // deliberate defense-in-depth: a cheap runtime guard against a future
  // refactor that loosens the type or pipes in real data by mistake, given
  // this product's zero-tolerance stance on showing an unlabelled real
  // number (principle (c)).
  if (!record.fictional) throw new Error('ADR 049: refusing to render a record not marked fictional');
  return (
    <>
      <strong className="block text-sm font-semibold">{record.name}</strong>
      <span className="block text-xs">{t(lang, 'lab3d.population')}: <span className="tnum">{formatPopulation(populationIn(record, year), lang)}</span></span>
      <span className="block text-xs">{t(lang, 'lab3d.growth')}: <span className="tnum">{formatGrowth(growthSince(record, year), lang)}</span></span>
      <span className="mt-1 block text-[10px] font-bold uppercase tracking-wide text-warning">{t(lang, 'lab3d.badge')}</span>
    </>
  );
}

export function Map3d({ lang }: { lang: Lang }): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const reducedAtMount = useRef(reduced);
  const { resolvedTheme } = useTheme();
  const theme: Theme = resolvedTheme === 'dark' ? 'dark' : 'light';

  const [status, setStatus] = useState<Status>('loading');
  const [dataset, setDataset] = useState<FakeDataset | null>(null);
  const [year, setYear] = useState(YEAR_START);
  const [playing, setPlaying] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  // Load the boundaries (own origin only), build the FICTIONAL dataset and the scene.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(TOPOJSON_URL);
        if (!res.ok) throw new Error(`asset ${res.status}`);
        const features = decodeMunicipalities(await res.json());
        const data = buildFakeDataset(features.map((f) => ({ code: f.code, name: f.name, areaKm2: areaKm2(f) })));
        if (cancelled) return;
        setDataset(data);
        const canvas = canvasRef.current;
        const scene = canvas ? createScene(canvas, buildColumns(features), buildFloor(features), data, { theme, reducedMotion: reducedAtMount.current }) : null;
        if (cancelled) { scene?.dispose(); return; }
        sceneRef.current = scene;
        setStatus(scene ? 'ready' : 'unavailable');
      } catch {
        if (!cancelled) setStatus('failed');
      }
    })();
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only; theme/reduced updates flow through the effects below
  }, []);

  useEffect(() => { sceneRef.current?.setTheme(theme); }, [theme, status]);
  useEffect(() => { sceneRef.current?.setYear(year, true); }, [year, status]);
  useEffect(() => { sceneRef.current?.setFilter(filter); }, [filter, status]);
  useEffect(() => { sceneRef.current?.setHighlight(pinned ?? hover?.code ?? null); }, [pinned, hover, status]);

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      setYear((y) => {
        if (y >= YEAR_END) { setPlaying(false); return y; }
        return y + 1;
      });
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => sceneRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frame = useRef<number | null>(null);
  // Code-review fix (2026-09-15): cancel a pending pointer-move rAF on
  // unmount — without this, a frame scheduled just before navigating away
  // still fired after the mount effect's own cleanup disposed the scene,
  // calling `scene.pick()` on a disposed SceneHandle and `setHover()` on an
  // unmounted component (the pending callback closes over its own local
  // `scene` variable, so nulling sceneRef.current on unmount doesn't stop it).
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>): void {
    const scene = sceneRef.current;
    if (!scene || frame.current !== null) return;
    const { clientX, clientY } = e;
    const box = wrapperRef.current?.getBoundingClientRect();
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const code = scene.pick(clientX, clientY);
      setHover(code && box ? { code, x: clientX - box.left + 12, y: clientY - box.top + 12 } : null);
    });
  }
  function onClick(e: ReactPointerEvent<HTMLCanvasElement>): void {
    const code = sceneRef.current?.pick(e.clientX, e.clientY) ?? null;
    setPinned((p) => (p === code ? null : code));
  }

  const records = dataset?.records ?? [];
  const byCode = new Map(records.map((r) => [r.code, r]));
  const shown = pinned ? byCode.get(pinned) : undefined;
  const hovered = hover ? byCode.get(hover.code) : undefined;
  const statusText = status === 'loading' ? t(lang, 'lab3d.loading') : status === 'unavailable' ? t(lang, 'lab3d.unavailable') : status === 'failed' ? t(lang, 'lab3d.loadFailed') : null;

  return (
    <section aria-label={t(lang, 'lab3d.mapLabel')} data-map3d="true" data-reduced-motion={reducedAtMount.current ? 'true' : 'false'} onKeyDown={(e) => { if (e.key === 'Escape') setPinned(null); }}>
      <div ref={wrapperRef} className="relative h-[60vh] min-h-[420px] w-full overflow-hidden rounded-lg border border-border bg-card">
        <canvas ref={canvasRef} className="block h-full w-full touch-none" onPointerMove={onPointerMove} onPointerLeave={() => setHover(null)} onClick={onClick} />
        {/* D3′ (ADR 049 v2): the floating legend card, replacing the old below-canvas gradient bar. */}
        <Legend lang={lang} />
        {/* Watermark: aria-hidden (the banner carries the accessible text); pointer-events-none so orbiting still works. */}
        <div aria-hidden="true" data-watermark="true" className="pointer-events-none absolute inset-0 grid select-none grid-cols-3 place-items-center opacity-[0.12]">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="-rotate-12 text-4xl font-black uppercase tracking-widest text-foreground">{t(lang, 'lab3d.watermark')}</span>
          ))}
        </div>
        {statusText ? <p role="status" className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">{statusText}</p> : null}
        {hovered && !pinned && hover ? (
          <div role="tooltip" data-fictional="true" className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md" style={{ left: hover.x, top: hover.y }}>
            <Details record={hovered} year={year} lang={lang} />
          </div>
        ) : null}
      </div>

      {/* D5′ (ADR 049 v2): one primary row — year + scrubber + play/pause +
          municipality picker — with the type filter and reset-view button
          de-emphasised into a smaller, visually secondary row underneath.
          Neither control is deleted, just given less visual weight. */}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col text-xs text-muted-foreground">
          {/* htmlFor/id, not label-wraps-input: wrapping would have pulled
              the year VALUE span's text into the input's accessible name
              too ("Jaar 1995" instead of "Jaar"), breaking getByLabelText.
              A plain span, not <output>, for the value: <output> carries an
              IMPLICIT role="status", which collided with the page-status
              paragraph below and made "status" ambiguous (both caught by
              this file's own test run). */}
          <label htmlFor="lab3d-year">{t(lang, 'lab3d.year')}</label>
          <span className="flex items-center gap-2">
            <input id="lab3d-year" type="range" min={YEAR_START} max={YEAR_END} step={1} value={year} aria-valuetext={String(year)} onChange={(e) => { setPlaying(false); setYear(Number(e.target.value)); }} className="w-56" />
            <span data-year="true" className="tnum text-base font-semibold text-foreground">{year}</span>
          </span>
        </div>
        <Button type="button" variant="outline" size="sm" aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>
          {t(lang, playing ? 'lab3d.pause' : 'lab3d.play')}
        </Button>
        <label className="flex flex-col text-xs text-muted-foreground">
          {t(lang, 'lab3d.pickLabel')}
          <select value={pinned ?? ''} onChange={(e) => setPinned(e.target.value || null)} className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground">
            <option value="">{t(lang, 'lab3d.pickNone')}</option>
            {[...records].sort((a, b) => a.name.localeCompare(b.name, 'nl')).map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-3 text-xs text-muted-foreground/80">
        <label className="flex flex-col">
          {t(lang, 'lab3d.typeLabel')}
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground">
            <option value="all">{t(lang, 'lab3d.typeAll')}</option>
            <option value="city">{t(lang, 'lab3d.typeCity')}</option>
            <option value="mid">{t(lang, 'lab3d.typeMid')}</option>
            <option value="rural">{t(lang, 'lab3d.typeRural')}</option>
          </select>
        </label>
        <Button type="button" variant="ghost" size="sm" onClick={() => sceneRef.current?.resetView()}>{t(lang, 'lab3d.resetView')}</Button>
      </div>

      <div aria-live="polite" data-fictional="true" className="mt-3 min-h-6 rounded-md border border-border bg-card p-2 text-card-foreground">
        {shown ? <Details record={shown} year={year} lang={lang} /> : null}
      </div>
    </section>
  );
}

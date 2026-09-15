# 3D municipality map DEMO (fictional data) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone, login-gated, noindexed, unlinked demo page (`/bevolking-3d-demo`) that reproduces the owner's reference demo — every Dutch municipality as an extruded 3D column (height = population, colour = growth since 1995), a 1995–2025 year slider with play/pause, a municipality-type filter, hover/click details, a "reset view" button, both themes and a reduced-motion path — over **fictional, deterministic numbers**, labelled "DEMO — FICTIEVE DATA" in a way no JS failure, theme, screenshot or test refactor can remove.

**Architecture:** One route directory, `web/app/bevolking-3d-demo/`, holds everything (page, a server-rendered `DemoBanner`, a Client-Component `Map3dLoader` that `next/dynamic`-imports the only module that touches `three`, and pure modules for the fake data, the TopoJSON decode/projection, the colour/height scales and the mesh builder). The boundary file is a static asset under `web/public/demo/`, fetched from the app's own origin. Nothing imports `web/backend` (= `src/`), nothing calls an LLM, nothing writes an audit row, nothing changes the schema. Three.js lives in a route-private chunk; a test proves no other file in `web/` imports it.

**Tech Stack:** Next.js 16 App Router (`next/dynamic` with `ssr: false` inside a Client Component), React 19, **`three` (the owner-approved exception to the zero-library rule for chart visuals — the first and only one) + `@types/three`**, zod (already a dependency) for the TopoJSON schema, vitest + Testing Library (jsdom), the message catalogue (`web/lib/i18n/messages.ts`), next-themes (`useTheme`), `useMediaQuery` (`web/lib/use-media-query.ts`).

**Spec:** the main-session brief of 2026-09-15 (this plan's header + "Design decisions" restate every requirement); reference visual: the owner's own `checkdecijfers-3d-demo.vercel.app/nl-bevolking-3d` ("Nederland groeit, maar niet overal", labelled "FICTIEVE TESTDATA", footer "Cijfers: fictief, alleen ter demonstratie"). Context that MUST be honoured: ADR [044](../../decisions/044-story-stage.md)'s kickoff ruled a 3D map OUT of the product ("a 3D chart makes equal values look unequal … a WebGL canvas is invisible to every honesty scan and to the export (R6)") — this demo does not reopen that decision; it lives outside the product, and ADR 049 (written by the controller) says so.

## Design decisions taken for this plan (the ADR 049 rationale)

- **Placement: `web/app/bevolking-3d-demo/` → `/bevolking-3d-demo`.** Follows the flat, Dutch-noun top-level route precedent (`/galerij`, `/werkwijze`, `/systeemoverzicht`) and the internal explorer precedent (`web/app/eurostat-explorer/` on branch `wp30c-e1-eurostat-adapter`). The word "demo" is in the URL itself. Non-route files are colocated in the same directory (Next only routes `page`/`layout`/`route` files) so ONE directory is the isolation boundary the tests grep against — no demo code in `web/lib/` or `web/components/`.
- **Undiscoverable, four ways, each pinned:** (1) `robots: { index: false, follow: false }` in `generateMetadata` (the `/galerij` and `/eurostat-explorer` belt-and-suspenders pattern; `web/app/robots.ts` already disallows everything and there is no sitemap); (2) no link anywhere — a test walks `web/app`, `web/components`, `web/lib` and `web/proxy.ts` for the string `bevolking-3d-demo` and expects zero hits outside the demo directory; (3) **login-gated by default** — the route is simply not in `web/proxy.ts`'s `PUBLIC_EXACT_PATHS`, so an anonymous visit 307s to `/login` with zero proxy change (pinned via `isPublicPath('/bevolking-3d-demo') === false`); (4) no env flag — **argued:** the Eurostat explorer's flag exists because it must NEVER appear in production (ADR 048 D3), whereas this demo is meant to be shown from the production deployment by the signed-in owner; a flag would add a RUNBOOK secret and a "forgot to set it" failure for no honesty gain. **Open question (#250):** if the owner wants to share the link with an outsider, add `'/bevolking-3d-demo'` and the `'/demo/'` asset prefix to the proxy allowlists (two lines + `proxy.test.ts` pins) — an explicit owner decision, not made here.
- **The boundary file is a static asset, not a module import.** `web/public/demo/gemeente_2024.topojson` (169 KB), fetched at runtime from the app's own origin (`/demo/gemeente_2024.topojson`). Importing it as JSON would inline 169 KB into the route's JS chunk (parsed as JS, uncacheable separately, inflating the bundle number this plan measures); a static asset is CDN-cached, parsed in parallel, and stays out of every bundle. It is never fetched from cartomap/PDOK at runtime — the download is a one-time, owner-approved step (Task 4). Because `web/proxy.ts`'s matcher does not exclude `.topojson`, the asset request runs through the session check like the page itself — fine while both are login-gated (same-origin `fetch` sends the session cookie).
- **Library: `three` + `@types/three`, nothing else.** TopoJSON decoding is hand-rolled (≈40 lines: arc delta-decoding with the quantisation transform, negative-index reversal, ring joining) rather than adding `topojson-client` — it keeps the approved exception at exactly one library, and the decoder is fully unit-tested against an inline two-municipality fixture. Extrusion uses `three`'s own `Shape`/`Path`/`ExtrudeGeometry` (holes supported); camera control uses `three/addons/controls/OrbitControls.js` (inside the `three` package). No `@react-three/fiber`, no `drei`, no tween library (a 350 ms cubic ease-out is eight lines).
- **Bundle discipline, measured not asserted.** `three` is referenced in exactly one place: `map3d-loader.tsx`'s `dynamic(() => import('./map3d.tsx'), { ssr: false })`. Route-level code-splitting already keeps the route's modules off every other page; the dynamic import additionally keeps the WebGL code out of the SSR bundle and off the critical path. The controller records, in ADR 049, the `next build` "First Load JS" for `/`, `/galerij` and `/geschiedenis` on `main` vs. the branch (must be identical) and for `/bevolking-3d-demo` itself. **Estimate to be verified: ≈150–180 kB gzipped** for `WebGLRenderer` + `ExtrudeGeometry` (pulls `ShapeUtils`/Earcut) + `OrbitControls` + lights + `Raycaster`; **ceiling: 250 kB** for the route-private chunk — above that, the controller stops and reports before merging.
- **Fictional data, deterministic and name-blind.** `fake-data.ts` seeds a `mulberry32` PRNG from an FNV-1a hash of the municipality CODE only; density is log-uniform per km² of the (real) polygon area; a per-municipality yearly trend in −0.8 %…+1.6 % plus tiny noise builds the 31-year series. Same file in → same numbers out, forever. The generator never sees a name and is deliberately NOT tuned to resemble real figures: a fake that "looks right" for Amsterdam is more dangerous than one that looks off (principle (c) applied to a demo).
- **Labelling — visual chrome, five layers:** (1) a server-rendered `DemoBanner` (`role="note"`, warning-token border, bold uppercase "DEMO — FICTIEVE DATA" + one explanatory sentence) rendered by the PAGE, so it exists in the HTML before any JS and survives a failed 3D chunk; (2) a diagonal "FICTIEF" watermark overlay across the canvas (`aria-hidden`, `pointer-events-none`) so every screenshot carries it; (3) every number-bearing element (tooltip, details panel, legend) sits inside `data-fictional="true"` and every label says "(fictief)/(fictional)"; (4) the `<title>` says "Demo … (fictieve data)"; (5) the footer line "Cijfers: fictief, alleen ter demonstratie." Locks: the page test pins (1)/(4)/(5); the component test pins (2)/(3) and walks every text node — a digit outside `[data-fictional]` or `[data-year]` fails the test, the same tree-walker discipline as `scanForUnboundDigits` in `web/components/chart.test.tsx:1958`; `DemoBanner`'s props type is `{ lang }` only (a `// @ts-expect-error` line proves no `hidden`-style prop compiles).
- **Colours reuse the house palette.** Growth is a diverging scale between `DEFAULT_PALETTE[1]` (`#d55e00`, shrinking) and `DEFAULT_PALETTE[0]` (`#0072b2`, growing) from `web/lib/chart-presentation.ts:93`, through a neutral midpoint per theme; endpoints pinned to be palette members and ≥ 3:1 against both cards via the existing `contrastRatio`. The WebGL scene needs two literal hex values per theme (base plate, neutral midpoint) because a canvas cannot read CSS `oklch` tokens — a new sanctioned literal spot the controller adds to `docs/12-huisstijl.md` house rule 1.
- **Both themes:** `useTheme().resolvedTheme` → `scene.setTheme()` (plate colour, light intensity, midpoint); the renderer is `alpha: true` so the page's own `bg-background` shows behind the map. Verified in the browser pass in both themes.
- **Reduced motion:** `useMediaQuery('(prefers-reduced-motion: reduce)')` → year changes snap (no 350 ms tween), OrbitControls damping off, reset-view instant; play/pause still steps (a pausable slideshow, WCAG 2.3.3). Same mechanism ADR 044's stage uses.
- **Performance:** ≈342 meshes = ≈342 draw calls, ≈30 k triangles from the simplified shapes — trivial for any GPU; `MeshLambertMaterial`; pixel ratio capped at 2; **render on demand** (a rAF loop runs only while a tween or damping is active or something changed), so an idle page costs nothing; everything disposed on unmount.
- **Interaction:** pointer-move raycast (rAF-throttled) → hover highlight + DOM tooltip; click pins; Escape unpins; a `<select>` of all municipality names gives keyboard users the same details panel (`aria-live="polite"`); type filter dims non-matching columns to 15 % opacity rather than removing them.
- **Not touched, by construction and by test:** `src/answer/`, `src/query/`, `src/chart/`, prompts, `audit_answers`, migrations, env flags, `web/proxy.ts`; `web/lib/i18n/messages.ts` gains keys only. The benchmark and invariant suites cannot be affected: `git diff --stat main -- src/ tests/ benchmark/ migrations/` is empty on this branch (the reviewer's one-line confirmation).

## Global Constraints
- **Honesty:** every number on the page is fiction and is labelled as such at the element level (`data-fictional`) AND at the page level (banner, title, footer). No real statistic may enter this directory — no import from `../../backend/`, no `lib/db.ts`, no `@anthropic-ai`, no `fetch` of an `http(s)://` URL (all pinned by `isolation.test.ts`). The fake generator is name-blind (pinned). Municipality NAMES and BOUNDARIES are real (CBS/PDOK, CC BY 4.0) and attributed in the footer.
- **Bundle:** `three` is imported only under `web/app/bevolking-3d-demo/` and only reached through `map3d-loader.tsx`'s dynamic import (pinned). Route-private chunk ≤ 250 kB gzipped as printed by `next build` (controller-measured).
- **Both themes, tokens for all DOM chrome** (only the two WebGL literals per theme in `scales.ts`); `prefers-reduced-motion` honoured; no CSS `aspect-ratio` (the session-92 lesson — the map wrapper uses an explicit height class).
- **Every new interface string** has `nl` and `en` entries in `web/lib/i18n/messages.ts`, digit-free (the `lab3d.footer` line is the one exception — "CC BY 4.0" — and it lives on the PAGE, outside the component's digit scan).
- **Commands:** web tests `cd web && npx vitest run app/bevolking-3d-demo`; typecheck `cd web && npx tsc --noEmit` and root `npx tsc --noEmit`; real build `npm run web:build` (root). Commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Branch `demo-3d-municipality-map` from `main`; autonomous work = branch + PR per [open-questions #118](../../open-questions.md)(b); never push to `main`.
- **Do the edits yourself in this run — do not spawn subagents, do not "background" the task.**

## File map
- Create `web/app/bevolking-3d-demo/fake-data.ts` (+ `.test.ts`): `DEMO_DATA_NOTICE`, `YEAR_START`/`YEAR_END`/`YEARS`, `fnv1a`, `mulberry32`, `typeFor`, `buildFakeDataset`, `populationIn`, `growthSince`, `yearIndex`.
- Create `web/app/bevolking-3d-demo/topojson.ts` (+ `.test.ts`): `decodeMunicipalities`, `project`, `areaKm2`, `TOPO_OBJECT`/`CODE_KEY`/`NAME_KEY`, `NL_CENTER`, `WORLD_UNITS_PER_DEGREE`.
- Create `web/app/bevolking-3d-demo/test-fixture.ts`: `TWO_SQUARES_TOPOLOGY` (shared by three test files; not a route file, not imported by any route module).
- Create `web/app/bevolking-3d-demo/scales.ts` (+ `.test.ts`): `growthColor`, `heightFor`, `mixHex`, `formatPopulation`, `formatGrowth`, `GROWTH_*`, `SCENE_COLORS`, `MIN_HEIGHT`/`MAX_HEIGHT`, `Theme`.
- Add `web/public/demo/gemeente_2024.topojson` (+ `web/app/bevolking-3d-demo/asset.test.ts`); `web/package.json` gains `three` + `@types/three`.
- Create `web/app/bevolking-3d-demo/columns.ts` (+ `.test.ts`): `buildColumns` → `ColumnMesh[]`.
- Create `web/app/bevolking-3d-demo/scene.ts` (+ `.test.ts`): `hasWebGl`, `createScene` → `SceneHandle | null`, `CAMERA_HOME`, `HEIGHT_TWEEN_MS`.
- Create `web/app/bevolking-3d-demo/demo-banner.tsx`, `map3d.tsx` (+ `map3d.test.tsx`); modify `web/lib/i18n/messages.ts` (26 keys × 2).
- Create `web/app/bevolking-3d-demo/map3d-loader.tsx`, `page.tsx` (+ `page.test.tsx`), `isolation.test.ts`.
- Docs (controller): ADR 049, `docs/08-build-plan.md`, `docs/12-huisstijl.md` (rule 1 literal spot), `docs/04-architecture.md` (one row: demo surfaces), `docs/open-questions.md` (#250 gating, #251 asset keys/licence line), STATUS/archive/lessons, `web/README.md` (one line: the demo route + its asset).

---

### Task 1: The fictional dataset (`fake-data.ts`)
**Files:** Create `web/app/bevolking-3d-demo/fake-data.ts`, `web/app/bevolking-3d-demo/fake-data.test.ts`

**Interfaces (produce exactly these):**
```ts
export const DEMO_DATA_NOTICE = 'FICTIEVE TESTDATA' as const;
export const YEAR_START = 1995;
export const YEAR_END = 2025;
export const YEARS: readonly number[]; // 1995 … 2025 inclusive (31 entries)
export type MunicipalityType = 'city' | 'mid' | 'rural';
export interface FakeMunicipalityInput { code: string; name: string; areaKm2: number }
export interface FakeMunicipalityRecord {
  readonly fictional: true;
  readonly code: string;
  readonly name: string; // display only — NEVER an input to the generator
  readonly type: MunicipalityType;
  readonly population: readonly number[]; // index 0 = YEAR_START … last = YEAR_END
}
export interface FakeDataset { readonly fictional: true; readonly notice: typeof DEMO_DATA_NOTICE; readonly records: readonly FakeMunicipalityRecord[]; readonly maxPopulation: number }
export function fnv1a(text: string): number;            // 32-bit FNV-1a, unsigned
export function mulberry32(seed: number): () => number;  // [0,1)
export function typeFor(populationAtEnd: number): MunicipalityType; // ≥100 000 city, ≥30 000 mid, else rural
export function buildFakeDataset(inputs: readonly FakeMunicipalityInput[]): FakeDataset;
export function yearIndex(year: number): number;          // clamped 0 … YEARS.length-1
export function populationIn(record: FakeMunicipalityRecord, year: number): number;
export function growthSince(record: FakeMunicipalityRecord, year: number): number; // fraction; 0 at YEAR_START
```

- [ ] **Step 1: Write the failing tests** — `web/app/bevolking-3d-demo/fake-data.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildFakeDataset, DEMO_DATA_NOTICE, fnv1a, growthSince, mulberry32, populationIn, typeFor, YEAR_END, YEAR_START, YEARS } from './fake-data.ts';

const inputs = Array.from({ length: 300 }, (_, i) => ({ code: `GM${String(i + 1).padStart(4, '0')}`, name: `Plaats ${i + 1}`, areaKm2: 5 + ((i * 37) % 400) }));

describe('fake-data — fictional, deterministic, name-blind (ADR 049)', () => {
  it('spans 1995–2025 inclusive', () => {
    expect(YEAR_START).toBe(1995);
    expect(YEAR_END).toBe(2025);
    expect(YEARS).toHaveLength(31);
    expect(YEARS[0]).toBe(1995);
    expect(YEARS[30]).toBe(2025);
  });
  it('is deterministic: the same inputs yield byte-identical output on every call', () => {
    expect(buildFakeDataset(inputs)).toEqual(buildFakeDataset(inputs));
  });
  it('is name-blind: only the code and the area drive the numbers', () => {
    const a = buildFakeDataset([{ code: 'GM0363', name: 'Een naam', areaKm2: 219 }]);
    const b = buildFakeDataset([{ code: 'GM0363', name: 'Een heel andere naam', areaKm2: 219 }]);
    expect(a.records[0]!.population).toEqual(b.records[0]!.population);
  });
  it('different codes give different series', () => {
    const d = buildFakeDataset([{ code: 'GM0001', name: 'x', areaKm2: 50 }, { code: 'GM0002', name: 'x', areaKm2: 50 }]);
    expect(d.records[0]!.population).not.toEqual(d.records[1]!.population);
  });
  it('every record and the dataset itself are marked fictional, with the fixed notice', () => {
    const d = buildFakeDataset(inputs);
    expect(d.fictional).toBe(true);
    expect(d.notice).toBe(DEMO_DATA_NOTICE);
    expect(DEMO_DATA_NOTICE).toBe('FICTIEVE TESTDATA');
    for (const r of d.records) expect(r.fictional).toBe(true);
  });
  it('shapes: 31 integer values ≥ 500 per record; growth over the whole range stays plausible-looking but is never tuned to a real place', () => {
    const d = buildFakeDataset(inputs);
    expect(d.records).toHaveLength(300);
    for (const r of d.records) {
      expect(r.population).toHaveLength(31);
      for (const p of r.population) {
        expect(Number.isInteger(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(500);
      }
      const g = growthSince(r, YEAR_END);
      expect(g).toBeGreaterThan(-0.4);
      expect(g).toBeLessThan(0.75);
      expect(growthSince(r, YEAR_START)).toBe(0);
      expect(populationIn(r, YEAR_START)).toBe(r.population[0]);
      expect(populationIn(r, 9999)).toBe(r.population[30]);
    }
    expect(d.maxPopulation).toBe(Math.max(...d.records.flatMap((r) => [...r.population])));
  });
  it('types follow the end-year population thresholds', () => {
    expect(typeFor(100_000)).toBe('city');
    expect(typeFor(99_999)).toBe('mid');
    expect(typeFor(30_000)).toBe('mid');
    expect(typeFor(29_999)).toBe('rural');
  });
  it('the primitives are stable (hash and PRNG pinned so the demo numbers never drift silently)', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    const r = mulberry32(1);
    const first = r();
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
    expect(mulberry32(1)()).toBe(first);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd web && npx vitest run app/bevolking-3d-demo/fake-data.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `web/app/bevolking-3d-demo/fake-data.ts`:
```ts
// ADR 049: the 3D municipality DEMO's data — ALL OF IT IS FICTION.
// This module is the only producer of a number shown on /bevolking-3d-demo.
// It never reads a real statistic, never touches the database, never sees a
// municipality NAME (only its code and its polygon area), and is
// deterministic: the same boundary file yields the same fake numbers on
// every load. The numbers are deliberately NOT tuned to resemble real
// municipalities — a fake that looks right for a known city is more
// dangerous than one that looks off (principle (c), applied to a demo).
// Every record and the dataset carry `fictional: true`; the UI marks every
// element that shows one of these numbers with data-fictional (map3d.tsx).
export const DEMO_DATA_NOTICE = 'FICTIEVE TESTDATA' as const;
export const YEAR_START = 1995;
export const YEAR_END = 2025;
export const YEARS: readonly number[] = Array.from({ length: YEAR_END - YEAR_START + 1 }, (_, i) => YEAR_START + i);
const DEMO_SEED = 0x3dde0001;

export type MunicipalityType = 'city' | 'mid' | 'rural';

export interface FakeMunicipalityInput {
  code: string;
  name: string;
  areaKm2: number;
}
export interface FakeMunicipalityRecord {
  readonly fictional: true;
  readonly code: string;
  readonly name: string;
  readonly type: MunicipalityType;
  readonly population: readonly number[];
}
export interface FakeDataset {
  readonly fictional: true;
  readonly notice: typeof DEMO_DATA_NOTICE;
  readonly records: readonly FakeMunicipalityRecord[];
  readonly maxPopulation: number;
}

/** 32-bit FNV-1a — a stable, dependency-free string hash. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — a tiny seeded PRNG; enough for demo noise, never for anything else. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function typeFor(populationAtEnd: number): MunicipalityType {
  if (populationAtEnd >= 100_000) return 'city';
  if (populationAtEnd >= 30_000) return 'mid';
  return 'rural';
}

function fakeSeries(code: string, areaKm2: number): number[] {
  const rng = mulberry32(fnv1a(code) ^ DEMO_SEED);
  const density = Math.exp(4 + rng() * 4.2); // ≈ 55 … ≈ 3 600 per km², log-uniform
  let pop = Math.max(800, Math.round(Math.max(1, areaKm2) * density));
  const trend = -0.008 + rng() * 0.024; // −0.8 % … +1.6 % per year
  const series = [pop];
  for (let i = 1; i < YEARS.length; i++) {
    const noise = (rng() - 0.5) * 0.01;
    pop = Math.max(500, Math.round(pop * (1 + trend + noise)));
    series.push(pop);
  }
  return series;
}

export function buildFakeDataset(inputs: readonly FakeMunicipalityInput[]): FakeDataset {
  const records = inputs.map((m): FakeMunicipalityRecord => {
    const population = fakeSeries(m.code, m.areaKm2);
    return { fictional: true, code: m.code, name: m.name, type: typeFor(population[population.length - 1]!), population };
  });
  const maxPopulation = records.reduce((max, r) => Math.max(max, ...r.population), 0);
  return { fictional: true, notice: DEMO_DATA_NOTICE, records, maxPopulation };
}

export function yearIndex(year: number): number {
  return Math.min(YEARS.length - 1, Math.max(0, Math.round(year) - YEAR_START));
}
export function populationIn(record: FakeMunicipalityRecord, year: number): number {
  return record.population[yearIndex(year)]!;
}
/** Fraction: +0.12 = twelve percent more than at YEAR_START. */
export function growthSince(record: FakeMunicipalityRecord, year: number): number {
  const base = record.population[0]!;
  return base > 0 ? populationIn(record, year) / base - 1 : 0;
}
```

- [ ] **Step 4: Run** → PASS (if the `fnv1a('a')` pin disagrees with the implementation, the IMPLEMENTATION is wrong — `0xe40c292c` is the published FNV-1a test vector for "a").
- [ ] **Step 5: Commit**
```bash
git add web/app/bevolking-3d-demo/fake-data.ts web/app/bevolking-3d-demo/fake-data.test.ts
git commit -m "feat(demo): fictional, deterministic, name-blind municipality dataset for the 3D map demo (ADR 049)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: TopoJSON decode, projection, area (`topojson.ts`)
**Files:** Create `web/app/bevolking-3d-demo/topojson.ts`, `web/app/bevolking-3d-demo/test-fixture.ts`, `web/app/bevolking-3d-demo/topojson.test.ts`

**Interfaces:**
```ts
export type LonLat = [number, number];
export interface MunicipalityFeature { code: string; name: string; /** polygon → rings (index 0 = outer, rest = holes) → points; every ring closed */ polygons: LonLat[][][] }
export const TOPO_OBJECT = 'gemeente_2024'; export const CODE_KEY = 'statcode'; export const NAME_KEY = 'statnaam'; // **Assumption** — verified loudly by asset.test.ts (Task 4)
export function decodeMunicipalities(raw: unknown, objectName?: string): MunicipalityFeature[]; // zod-validated; throws naming what it found
export const NL_CENTER: { lon: 5.3; lat: 52.2 }; export const WORLD_UNITS_PER_DEGREE = 60;
export function project(p: LonLat): [number, number]; // equirectangular around NL_CENTER, x scaled by cos(lat)
export function areaKm2(feature: MunicipalityFeature): number; // shoelace, outer minus holes, ≈ km²
```

- [ ] **Step 1: Write the fixture** — `web/app/bevolking-3d-demo/test-fixture.ts` (two unit squares sharing one edge; both counter-clockwise, so B traverses the shared arc REVERSED — that exercises the `~index` path):
```ts
// Two 0.1° × 0.1° squares sharing their vertical edge, quantised (scale
// 0.001, translate [5, 52]). A = GM0001 (left), B = GM0002 (right).
// arc 0: A's own three edges, arc 1: the shared edge (bottom → top), arc 2:
// B's own three edges. B uses arc 1 reversed (~1 = -2).
export const TWO_SQUARES_TOPOLOGY = {
  type: 'Topology',
  transform: { scale: [0.001, 0.001], translate: [5, 52] },
  objects: {
    gemeente_2024: {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Polygon', arcs: [[0, 1]], properties: { statcode: 'GM0001', statnaam: 'Aa' } },
        { type: 'Polygon', arcs: [[2, -2]], properties: { statcode: 'GM0002', statnaam: 'Bee' } },
      ],
    },
  },
  arcs: [
    [[100, 100], [-100, 0], [0, -100], [100, 0]],
    [[100, 0], [0, 100]],
    [[100, 0], [100, 0], [0, 100], [-100, 0]],
  ],
} as const;
```

- [ ] **Step 2: Write the failing tests** — `web/app/bevolking-3d-demo/topojson.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { TWO_SQUARES_TOPOLOGY } from './test-fixture.ts';
import { areaKm2, decodeMunicipalities, NL_CENTER, project, WORLD_UNITS_PER_DEGREE } from './topojson.ts';

describe('decodeMunicipalities — hand-rolled TopoJSON (ADR 049)', () => {
  it('decodes quantised, delta-encoded arcs and joins them into closed rings', () => {
    const [a, b] = decodeMunicipalities(TWO_SQUARES_TOPOLOGY);
    expect(a).toMatchObject({ code: 'GM0001', name: 'Aa' });
    expect(b).toMatchObject({ code: 'GM0002', name: 'Bee' });
    const ringA = a!.polygons[0]![0]!;
    const ringB = b!.polygons[0]![0]!;
    const close = (ring: [number, number][], expected: [number, number][]) => {
      expect(ring).toHaveLength(expected.length);
      ring.forEach(([x, y], i) => {
        expect(x).toBeCloseTo(expected[i]![0], 6);
        expect(y).toBeCloseTo(expected[i]![1], 6);
      });
    };
    close(ringA, [[5.1, 52.1], [5, 52.1], [5, 52], [5.1, 52], [5.1, 52.1]]);
    close(ringB, [[5.1, 52], [5.2, 52], [5.2, 52.1], [5.1, 52.1], [5.1, 52]]);
  });
  it('supports MultiPolygon and a topology without a transform (absolute arcs)', () => {
    const raw = {
      type: 'Topology',
      objects: { gemeente_2024: { type: 'GeometryCollection', geometries: [{ type: 'MultiPolygon', arcs: [[[0]], [[1]]], properties: { statcode: 'GM0003', statnaam: 'Cee' } }] } },
      arcs: [
        [[5, 52], [5.1, 52], [5.1, 52.1], [5, 52]],
        [[6, 52], [6.1, 52], [6.1, 52.1], [6, 52]],
      ],
    };
    const [c] = decodeMunicipalities(raw);
    expect(c!.polygons).toHaveLength(2);
    expect(c!.polygons[1]![0]![0]).toEqual([6, 52]);
  });
  it('fails loudly, naming what it found, when the object or the property keys are not what we assume', () => {
    expect(() => decodeMunicipalities({ ...TWO_SQUARES_TOPOLOGY, objects: { other: TWO_SQUARES_TOPOLOGY.objects.gemeente_2024 } })).toThrow(/objects present: other/);
    const badProps = { ...TWO_SQUARES_TOPOLOGY, objects: { gemeente_2024: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', arcs: [[0, 1]], properties: { GM_CODE: 'x' } }] } } };
    expect(() => decodeMunicipalities(badProps)).toThrow(/keys present: GM_CODE/);
    expect(() => decodeMunicipalities({ type: 'Nope' })).toThrow();
  });
});

describe('project / areaKm2', () => {
  it('projects around the NL centre, x compressed by cos(lat); the centre maps to the origin', () => {
    expect(project([NL_CENTER.lon, NL_CENTER.lat])).toEqual([0, 0]);
    const [x, y] = project([5.1, 52.1]);
    expect(y).toBeCloseTo(-0.1 * WORLD_UNITS_PER_DEGREE, 6);
    expect(x).toBeCloseTo(-0.2 * Math.cos((52.2 * Math.PI) / 180) * WORLD_UNITS_PER_DEGREE, 6);
  });
  it('a 0.1° square at 52° is roughly 76 km²; a hole is subtracted', () => {
    const [a] = decodeMunicipalities(TWO_SQUARES_TOPOLOGY);
    expect(areaKm2(a!)).toBeCloseTo(75.8, 0);
    const withHole = { ...a!, polygons: [[a!.polygons[0]![0]!, [[5.02, 52.02], [5.04, 52.02], [5.04, 52.04], [5.02, 52.04], [5.02, 52.02]] as [number, number][]]] };
    expect(areaKm2(withHole)).toBeLessThan(areaKm2(a!));
    expect(areaKm2(withHole)).toBeGreaterThan(areaKm2(a!) * 0.9);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `cd web && npx vitest run app/bevolking-3d-demo/topojson.test.ts` → FAIL.

- [ ] **Step 4: Implement** `web/app/bevolking-3d-demo/topojson.ts`:
```ts
// ADR 049: a minimal TopoJSON → municipality-polygon decoder (≈40 lines) and
// the demo's map projection. Hand-rolled instead of `topojson-client` so the
// demo's only new library stays `three`. Validated with zod so a file that is
// not what we assume fails LOUDLY, naming what it actually contains, instead
// of rendering an empty map.
import { z } from 'zod';

export type LonLat = [number, number];
export interface MunicipalityFeature {
  code: string;
  name: string;
  polygons: LonLat[][][];
}

// **Assumption** (open-questions #251): the cartomap gemeente_2024 file keeps
// PDOK/CBS's `statcode`/`statnaam` properties under an object named after the
// file. asset.test.ts (Task 4) verifies this against the real file and prints
// the real keys on a mismatch — the fix is these three constants, nothing else.
export const TOPO_OBJECT = 'gemeente_2024';
export const CODE_KEY = 'statcode';
export const NAME_KEY = 'statnaam';

const arcIndexes = z.array(z.number().int());
const properties = z.record(z.string(), z.unknown()).optional();
const geometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), arcs: z.array(arcIndexes), properties }),
  z.object({ type: z.literal('MultiPolygon'), arcs: z.array(z.array(arcIndexes)), properties }),
]);
const topologySchema = z.object({
  type: z.literal('Topology'),
  transform: z.object({ scale: z.tuple([z.number(), z.number()]), translate: z.tuple([z.number(), z.number()]) }).optional(),
  objects: z.record(z.string(), z.object({ type: z.literal('GeometryCollection'), geometries: z.array(geometry) })),
  arcs: z.array(z.array(z.tuple([z.number(), z.number()]))),
});
type Topology = z.infer<typeof topologySchema>;

function decodeArc(topology: Topology, index: number): LonLat[] {
  const arc = topology.arcs[index];
  if (!arc) throw new Error(`topojson: arc ${index} does not exist`);
  const t = topology.transform;
  if (!t) return arc.map(([x, y]) => [x, y]);
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]];
  });
}

function decodeRing(topology: Topology, indexes: number[]): LonLat[] {
  const out: LonLat[] = [];
  for (const i of indexes) {
    let points = decodeArc(topology, i < 0 ? ~i : i);
    if (i < 0) points = points.slice().reverse();
    out.push(...(out.length > 0 ? points.slice(1) : points));
  }
  return out;
}

export function decodeMunicipalities(raw: unknown, objectName: string = TOPO_OBJECT): MunicipalityFeature[] {
  const topology = topologySchema.parse(raw);
  const object = topology.objects[objectName];
  if (!object) throw new Error(`topojson: object "${objectName}" not found; objects present: ${Object.keys(topology.objects).join(', ')}`);
  return object.geometries.map((g, i) => {
    const props = g.properties ?? {};
    const code = props[CODE_KEY];
    const name = props[NAME_KEY];
    if (typeof code !== 'string' || typeof name !== 'string') {
      throw new Error(`topojson: geometry ${i} lacks string "${CODE_KEY}"/"${NAME_KEY}"; keys present: ${Object.keys(props).join(', ')}`);
    }
    const polygons = g.type === 'Polygon' ? [g.arcs] : g.arcs;
    return { code, name, polygons: polygons.map((rings) => rings.map((ring) => decodeRing(topology, ring))) };
  });
}

// --- projection ---------------------------------------------------------------
// Equirectangular around the middle of the country, x compressed by cos(lat):
// the Netherlands spans ≈ 2.8° of latitude, so this is visually indistinguishable
// from a conformal projection at demo scale and needs no library.
export const NL_CENTER = { lon: 5.3, lat: 52.2 } as const;
export const WORLD_UNITS_PER_DEGREE = 60;
const COS_LAT = Math.cos((NL_CENTER.lat * Math.PI) / 180);

export function project([lon, lat]: LonLat): [number, number] {
  return [(lon - NL_CENTER.lon) * COS_LAT * WORLD_UNITS_PER_DEGREE, (lat - NL_CENTER.lat) * WORLD_UNITS_PER_DEGREE];
}

const KM_PER_DEGREE = 111.2;
function ringAreaKm2(ring: LonLat[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    sum += x1 * y2 - x2 * y1;
  }
  return (Math.abs(sum) / 2) * KM_PER_DEGREE * KM_PER_DEGREE * COS_LAT;
}
/** Only ever feeds the fake generator's density input — an APPROXIMATE area is fine. */
export function areaKm2(feature: MunicipalityFeature): number {
  return feature.polygons.reduce((total, rings) => total + rings.reduce((acc, ring, i) => acc + (i === 0 ? 1 : -1) * ringAreaKm2(ring), 0), 0);
}
```

- [ ] **Step 5: Run** → PASS. Typecheck clean.
- [ ] **Step 6: Commit**
```bash
git add web/app/bevolking-3d-demo/topojson.ts web/app/bevolking-3d-demo/test-fixture.ts web/app/bevolking-3d-demo/topojson.test.ts
git commit -m "feat(demo): hand-rolled TopoJSON decoder, NL projection and polygon area for the 3D map demo (ADR 049)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Colour and height scales, number formatting (`scales.ts`)
**Files:** Create `web/app/bevolking-3d-demo/scales.ts`, `web/app/bevolking-3d-demo/scales.test.ts`

**Interfaces:**
```ts
export type Theme = 'light' | 'dark';
export const GROWTH_DOMAIN = 0.4;                       // ±40 % maps to the two ends
export const GROWTH_LOW_HEX: string;                    // = DEFAULT_PALETTE[1] '#d55e00' (shrinking)
export const GROWTH_HIGH_HEX: string;                   // = DEFAULT_PALETTE[0] '#0072b2' (growing)
export const GROWTH_MID_HEX: Record<Theme, string>;     // { light: '#bfbfbf', dark: '#525252' }
export const SCENE_COLORS: Record<Theme, { plate: string }>; // { light: { plate: '#e5e5e5' }, dark: { plate: '#262626' } }
export const MIN_HEIGHT = 0.4; export const MAX_HEIGHT = 40;
export function mixHex(a: string, b: string, t: number): string;   // sRGB channel lerp, t clamped, lowercase '#rrggbb'
export function growthColor(growth: number, theme: Theme): string; // NaN → mid
export function heightFor(population: number, maxPopulation: number): number; // linear MIN..MAX, clamped
export function formatPopulation(n: number, lang: Lang): string;   // Intl nl-NL / en-GB, integer
export function formatGrowth(g: number, lang: Lang): string;       // '+12,3 %' / '+12.3 %', sign except zero
```

- [ ] **Step 1: Write the failing tests** — `web/app/bevolking-3d-demo/scales.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { CARD_DARK, CARD_LIGHT, contrastRatio, DEFAULT_PALETTE } from '../../lib/chart-presentation.ts';
import { formatGrowth, formatPopulation, GROWTH_DOMAIN, GROWTH_HIGH_HEX, GROWTH_LOW_HEX, GROWTH_MID_HEX, growthColor, heightFor, MAX_HEIGHT, MIN_HEIGHT, mixHex } from './scales.ts';

describe('growth colour scale — the house palette, never an invented one (ADR 049)', () => {
  it('its two ends ARE the first two designed-default palette colours', () => {
    expect(GROWTH_LOW_HEX).toBe(DEFAULT_PALETTE[1]);
    expect(GROWTH_HIGH_HEX).toBe(DEFAULT_PALETTE[0]);
  });
  it('both ends clear 3:1 against both cards (the ADR 042 pin, re-asserted here so the demo cannot drift from it)', () => {
    for (const hex of [GROWTH_LOW_HEX, GROWTH_HIGH_HEX]) {
      expect(contrastRatio(hex, CARD_LIGHT)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(hex, CARD_DARK)).toBeGreaterThanOrEqual(3);
    }
  });
  it('zero growth is the theme midpoint; the domain ends and beyond saturate; NaN is neutral', () => {
    expect(growthColor(0, 'light')).toBe(GROWTH_MID_HEX.light);
    expect(growthColor(0, 'dark')).toBe(GROWTH_MID_HEX.dark);
    expect(growthColor(GROWTH_DOMAIN, 'light')).toBe(GROWTH_HIGH_HEX);
    expect(growthColor(2, 'light')).toBe(GROWTH_HIGH_HEX);
    expect(growthColor(-GROWTH_DOMAIN, 'dark')).toBe(GROWTH_LOW_HEX);
    expect(growthColor(-9, 'dark')).toBe(GROWTH_LOW_HEX);
    expect(growthColor(Number.NaN, 'light')).toBe(GROWTH_MID_HEX.light);
  });
  it('mixHex interpolates per channel and clamps t', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#000000', '#ffffff', -1)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 7)).toBe('#ffffff');
  });
});

describe('heightFor — linear, floored so the smallest column is still pickable', () => {
  it('maps 0 → MIN, max → MAX, half → the midpoint; degenerate input → MIN', () => {
    expect(heightFor(0, 1000)).toBe(MIN_HEIGHT);
    expect(heightFor(1000, 1000)).toBe(MAX_HEIGHT);
    expect(heightFor(500, 1000)).toBeCloseTo((MIN_HEIGHT + MAX_HEIGHT) / 2, 6);
    expect(heightFor(5000, 1000)).toBe(MAX_HEIGHT);
    expect(heightFor(10, 0)).toBe(MIN_HEIGHT);
  });
});

describe('formatting', () => {
  it('population uses the locale thousands separator; growth is a signed one-decimal percentage', () => {
    expect(formatPopulation(1234567, 'nl')).toBe('1.234.567');
    expect(formatPopulation(1234567, 'en')).toBe('1,234,567');
    expect(formatGrowth(0.1234, 'nl')).toBe('+12,3 %');
    expect(formatGrowth(-0.05, 'en')).toBe('-5.0 %');
    expect(formatGrowth(0, 'nl')).toBe('0,0 %');
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `web/app/bevolking-3d-demo/scales.ts`:
```ts
// ADR 049: the demo's colour/height scales. The growth scale runs between the
// first two DEFAULT_PALETTE colours (blue = growing, vermillion = shrinking)
// through a neutral midpoint — the house palette, not a new one. The two
// literal greys per theme exist because a WebGL canvas cannot read the CSS
// oklch tokens: they are the demo's sanctioned literal spot (docs/12-huisstijl.md rule 1).
import { DEFAULT_PALETTE } from '../../lib/chart-presentation.ts';
import type { Lang } from '../../lib/i18n/messages.ts';

export type Theme = 'light' | 'dark';

export const GROWTH_DOMAIN = 0.4;
export const GROWTH_LOW_HEX = DEFAULT_PALETTE[1]!;
export const GROWTH_HIGH_HEX = DEFAULT_PALETTE[0]!;
export const GROWTH_MID_HEX: Record<Theme, string> = { light: '#bfbfbf', dark: '#525252' };
export const SCENE_COLORS: Record<Theme, { plate: string }> = { light: { plate: '#e5e5e5' }, dark: { plate: '#262626' } };

export const MIN_HEIGHT = 0.4;
export const MAX_HEIGHT = 40;

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mixHex(a: string, b: string, t: number): string {
  const k = clamp01(t);
  const ca = channels(a);
  const cb = channels(b);
  const out = ca.map((c, i) => Math.round(c + (cb[i]! - c) * k));
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function growthColor(growth: number, theme: Theme): string {
  const g = Number.isFinite(growth) ? Math.max(-GROWTH_DOMAIN, Math.min(GROWTH_DOMAIN, growth)) : 0;
  const mid = GROWTH_MID_HEX[theme];
  return g < 0 ? mixHex(mid, GROWTH_LOW_HEX, -g / GROWTH_DOMAIN) : mixHex(mid, GROWTH_HIGH_HEX, g / GROWTH_DOMAIN);
}

export function heightFor(population: number, maxPopulation: number): number {
  if (!(maxPopulation > 0) || !(population > 0)) return MIN_HEIGHT;
  return MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * Math.min(1, population / maxPopulation);
}

const locale = (lang: Lang): string => (lang === 'nl' ? 'nl-NL' : 'en-GB');
export function formatPopulation(n: number, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 0 }).format(Math.round(n));
}
export function formatGrowth(g: number, lang: Lang): string {
  const pct = new Intl.NumberFormat(locale(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(g * 100);
  return `${pct} %`;
}
```
  (If `Intl` in the test Node prints a Unicode minus for `en-GB`, pin the actual character the runtime produces rather than the ASCII hyphen — the formatting is locale-owned, not ours.)

- [ ] **Step 4: Run** → PASS. **Commit**
```bash
git add web/app/bevolking-3d-demo/scales.ts web/app/bevolking-3d-demo/scales.test.ts
git commit -m "feat(demo): growth colour scale on the house palette, linear column height, locale formatting (ADR 049)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Dependencies and the boundary asset
**Files:** Modify `web/package.json` + `web/package-lock.json`; add `web/public/demo/gemeente_2024.topojson`, `web/public/demo/README.md`; create `web/app/bevolking-3d-demo/asset.test.ts`

**Precondition:** the owner's explicit go-ahead for downloading `https://cartomap.github.io/nl/wgs84/gemeente_2024.topojson` — **granted 2026-09-15**; the file is already staged (main session downloaded it to the scratchpad pending this task's placement).

- [ ] **Step 1: Install exactly two packages** — `cd web && npm install three@^0.186.0 && npm install -D @types/three@^0.186.0` (check `npm view @types/three version` first and pin the minor that matches `three`'s; `@types/three` is DefinitelyTyped — `three` ships no types). Confirm `git diff web/package.json` shows ONLY these two lines added.

- [ ] **Step 2: Place the asset** at `web/public/demo/gemeente_2024.topojson` (169 KB). Add `web/public/demo/README.md`:
```md
gemeente_2024.topojson — Dutch municipality boundaries, 2024 edition, WGS84, simplified.
Source: https://cartomap.github.io/nl/wgs84/gemeente_2024.topojson (cartomap, from PDOK/CBS open
geodata, CC BY 4.0). Fetched ONCE, by hand, with the owner's go-ahead on 2026-09-15; the app never
downloads it at runtime — it is served from this origin only. Used solely by /bevolking-3d-demo,
whose numbers are fictional (ADR 049); only these boundaries and the municipality names are real.
```

- [ ] **Step 3: Write the real-asset sanity test** — `web/app/bevolking-3d-demo/asset.test.ts` (this is where the `TOPO_OBJECT`/`CODE_KEY`/`NAME_KEY` assumption meets reality; if it fails, the error names the real keys — fix the three constants in `topojson.ts`, nothing else):
```ts
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { areaKm2, decodeMunicipalities } from './topojson.ts';

const ASSET = fileURLToPath(new URL('../../public/demo/gemeente_2024.topojson', import.meta.url));

describe('the committed boundary asset (ADR 049) — real shapes, real names, and nothing else real', () => {
  it('exists, is the expected size class, and decodes under our assumed object/property names', () => {
    const size = statSync(ASSET).size;
    expect(size).toBeGreaterThan(100_000);
    expect(size).toBeLessThan(400_000);
    const features = decodeMunicipalities(JSON.parse(readFileSync(ASSET, 'utf8')));
    expect(features.length).toBeGreaterThanOrEqual(300);
    expect(features.length).toBeLessThanOrEqual(400);
    const codes = new Set(features.map((f) => f.code));
    expect(codes.size).toBe(features.length);
    for (const f of features) {
      expect(f.code).toMatch(/^GM\d{4}$/);
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.polygons.length).toBeGreaterThan(0);
      for (const rings of f.polygons) {
        const outer = rings[0]!;
        expect(outer.length).toBeGreaterThanOrEqual(4);
        expect(outer[0]).toEqual(outer[outer.length - 1]);
        for (const [lon, lat] of outer) {
          expect(lon).toBeGreaterThan(3.2);
          expect(lon).toBeLessThan(7.3);
          expect(lat).toBeGreaterThan(50.7);
          expect(lat).toBeLessThan(53.7);
        }
      }
    }
    const total = features.reduce((sum, f) => sum + areaKm2(f), 0);
    expect(total).toBeGreaterThan(30_000);
    expect(total).toBeLessThan(45_000);
  });
});
```

- [ ] **Step 4: Run** `cd web && npx vitest run app/bevolking-3d-demo/asset.test.ts` → PASS (or: fix the three constants per the error text, re-run). Typecheck clean (`@types/three` present).
- [ ] **Step 5: Commit**
```bash
git add web/package.json web/package-lock.json web/public/demo/gemeente_2024.topojson web/public/demo/README.md web/app/bevolking-3d-demo/asset.test.ts
git commit -m "feat(demo): add three + @types/three (the approved exception) and the CBS/PDOK municipality boundary asset (ADR 049)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Features → extruded columns (`columns.ts`, no renderer)
**Files:** Create `web/app/bevolking-3d-demo/columns.ts`, `web/app/bevolking-3d-demo/columns.test.ts`

**Interfaces:**
```ts
import type { ExtrudeGeometry, Mesh, MeshLambertMaterial } from 'three';
export interface ColumnMesh { code: string; name: string; mesh: Mesh<ExtrudeGeometry, MeshLambertMaterial> }
/** One mesh per municipality: the projected outer ring(s) as `Shape`s (holes as `Path`s), extruded depth 1 along +z; height is applied later via `mesh.scale.z`. `mesh.userData.code` carries the code for raycast picks. */
export function buildColumns(features: MunicipalityFeature[]): ColumnMesh[];
```

- [ ] **Step 1: Write the failing tests** — `web/app/bevolking-3d-demo/columns.test.ts` (three's geometry classes run in jsdom/node without WebGL):
```ts
import { describe, expect, it } from 'vitest';
import { buildColumns } from './columns.ts';
import { MIN_HEIGHT } from './scales.ts';
import { TWO_SQUARES_TOPOLOGY } from './test-fixture.ts';
import { decodeMunicipalities } from './topojson.ts';

describe('buildColumns (ADR 049)', () => {
  it('builds one extruded mesh per municipality, tagged with its code, at the floor height', () => {
    const columns = buildColumns(decodeMunicipalities(TWO_SQUARES_TOPOLOGY));
    expect(columns.map((c) => c.code)).toEqual(['GM0001', 'GM0002']);
    for (const c of columns) {
      expect(c.mesh.userData).toEqual({ code: c.code });
      expect(c.mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(c.mesh.scale.z).toBe(MIN_HEIGHT);
    }
  });
  it('a polygon with a hole produces a geometry with more vertices than the same polygon without it', () => {
    const [a] = decodeMunicipalities(TWO_SQUARES_TOPOLOGY);
    const hole: [number, number][] = [[5.02, 52.02], [5.04, 52.02], [5.04, 52.04], [5.02, 52.04], [5.02, 52.02]];
    const solid = buildColumns([a!])[0]!.mesh.geometry.getAttribute('position').count;
    const holed = buildColumns([{ ...a!, polygons: [[a!.polygons[0]![0]!, hole]] }])[0]!.mesh.geometry.getAttribute('position').count;
    expect(holed).toBeGreaterThan(solid); // the hole adds inner wall + more cap triangles
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `web/app/bevolking-3d-demo/columns.ts`:
```ts
// ADR 049: turns decoded municipality polygons into three.js meshes. No
// renderer here — this module is unit-tested in jsdom. Each mesh is extruded
// to depth 1 and later SCALED in z to the (fictional) population height, so
// the year slider only touches `scale.z`, never rebuilds geometry.
import { ExtrudeGeometry, Mesh, MeshLambertMaterial, Path, Shape } from 'three';
import { MIN_HEIGHT } from './scales.ts';
import { project, type LonLat, type MunicipalityFeature } from './topojson.ts';

export interface ColumnMesh {
  code: string;
  name: string;
  mesh: Mesh<ExtrudeGeometry, MeshLambertMaterial>;
}

function trace(ring: LonLat[], target: Shape | Path): void {
  ring.forEach((point, i) => {
    const [x, y] = project(point);
    if (i === 0) target.moveTo(x, y);
    else target.lineTo(x, y);
  });
  target.closePath();
}

export function buildColumns(features: MunicipalityFeature[]): ColumnMesh[] {
  return features.map((f) => {
    const shapes = f.polygons.map((rings) => {
      const shape = new Shape();
      trace(rings[0]!, shape);
      for (const hole of rings.slice(1)) {
        const path = new Path();
        trace(hole, path);
        shape.holes.push(path);
      }
      return shape;
    });
    const geometry = new ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });
    const material = new MeshLambertMaterial({ color: '#bfbfbf' });
    const mesh = new Mesh(geometry, material);
    mesh.userData = { code: f.code };
    mesh.scale.z = MIN_HEIGHT;
    return { code: f.code, name: f.name, mesh };
  });
}
```

- [ ] **Step 4: Run** → PASS (if the hole assertion turns out flaky on vertex counts, assert instead that `geometry.parameters.shapes[0].holes.length === 1` — `ExtrudeGeometry.parameters` keeps the input shapes). Typecheck clean.
- [ ] **Step 5: Commit**
```bash
git add web/app/bevolking-3d-demo/columns.ts web/app/bevolking-3d-demo/columns.test.ts
git commit -m "feat(demo): extruded municipality column meshes from decoded polygons (ADR 049)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The scene (`scene.ts` — renderer, controls, on-demand loop, pick, theme)
**Files:** Create `web/app/bevolking-3d-demo/scene.ts`, `web/app/bevolking-3d-demo/scene.test.ts`

**Interfaces:**
```ts
export interface SceneOptions { theme: Theme; reducedMotion: boolean }
export interface SceneHandle {
  setYear(year: number, animate: boolean): void;      // heights + colours; animate && !reducedMotion → 350 ms ease-out tween
  setTheme(theme: Theme): void;                        // plate colour, light intensity, neutral midpoint
  setFilter(type: MunicipalityType | 'all'): void;     // non-matching columns → 15 % opacity
  setHighlight(code: string | null): void;             // emissive lift on one column
  pick(clientX: number, clientY: number): string | null; // raycast → municipality code
  resetView(): void;                                   // camera back to CAMERA_HOME, target origin
  resize(): void;                                      // reads canvas.clientWidth/Height
  dispose(): void;                                     // cancels the loop, disposes controls/geometry/materials/renderer
}
export const CAMERA_HOME: Vector3; // (0, 230, 260)
export const HEIGHT_TWEEN_MS = 350;
export function hasWebGl(canvas: HTMLCanvasElement): boolean;
export function createScene(canvas: HTMLCanvasElement, columns: ColumnMesh[], dataset: FakeDataset, opts: SceneOptions): SceneHandle | null; // null = no WebGL (jsdom, old browsers) — never throws
```

- [ ] **Step 1: Write the failing tests** — `web/app/bevolking-3d-demo/scene.test.ts` (jsdom has no WebGL, so this pins the FALLBACK contract; the rendering itself is verified in the browser pass):
```ts
import { describe, expect, it } from 'vitest';
import { buildColumns } from './columns.ts';
import { buildFakeDataset } from './fake-data.ts';
import { CAMERA_HOME, createScene, hasWebGl, HEIGHT_TWEEN_MS } from './scene.ts';
import { TWO_SQUARES_TOPOLOGY } from './test-fixture.ts';
import { areaKm2, decodeMunicipalities } from './topojson.ts';

describe('createScene — the no-WebGL path (ADR 049)', () => {
  it('reports no WebGL in jsdom and returns null instead of throwing', () => {
    const canvas = document.createElement('canvas');
    expect(hasWebGl(canvas)).toBe(false);
    const features = decodeMunicipalities(TWO_SQUARES_TOPOLOGY);
    const dataset = buildFakeDataset(features.map((f) => ({ code: f.code, name: f.name, areaKm2: areaKm2(f) })));
    expect(createScene(canvas, buildColumns(features), dataset, { theme: 'light', reducedMotion: false })).toBeNull();
  });
  it('the home camera sits above the map and the tween is short', () => {
    expect(CAMERA_HOME.y).toBeGreaterThan(0);
    expect(HEIGHT_TWEEN_MS).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `web/app/bevolking-3d-demo/scene.ts`:
```ts
// ADR 049: the WebGL scene for the 3D municipality demo. Pure three.js, no
// React. Renders ON DEMAND: a requestAnimationFrame loop runs only while a
// height tween or OrbitControls damping is active, or something changed —
// an idle page costs nothing. Everything created here is disposed by
// `dispose()`. The ONLY numbers this scene shows are the FakeDataset's.
import { DirectionalLight, Group, HemisphereLight, Mesh, MeshLambertMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ColumnMesh } from './columns.ts';
import { growthSince, populationIn, YEAR_START, type FakeDataset, type FakeMunicipalityRecord, type MunicipalityType } from './fake-data.ts';
import { growthColor, heightFor, MIN_HEIGHT, SCENE_COLORS, type Theme } from './scales.ts';

export interface SceneOptions {
  theme: Theme;
  reducedMotion: boolean;
}
export interface SceneHandle {
  setYear(year: number, animate: boolean): void;
  setTheme(theme: Theme): void;
  setFilter(type: MunicipalityType | 'all'): void;
  setHighlight(code: string | null): void;
  pick(clientX: number, clientY: number): string | null;
  resetView(): void;
  resize(): void;
  dispose(): void;
}

export const CAMERA_HOME = new Vector3(0, 230, 260);
export const HEIGHT_TWEEN_MS = 350;

export function hasWebGl(canvas: HTMLCanvasElement): boolean {
  try {
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function createScene(canvas: HTMLCanvasElement, columns: ColumnMesh[], dataset: FakeDataset, opts: SceneOptions): SceneHandle | null {
  if (!hasWebGl(canvas)) return null;

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 1, 2000);
  camera.position.copy(CAMERA_HOME);

  const hemi = new HemisphereLight(0xffffff, 0x444444, 1.0);
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(120, 220, 160);
  scene.add(hemi, sun);

  // Columns are extruded along +z; rotate the whole map so z becomes "up".
  const map = new Group();
  map.rotation.x = -Math.PI / 2;
  scene.add(map);
  const plate = new Mesh(new PlaneGeometry(420, 420), new MeshLambertMaterial({ color: SCENE_COLORS[opts.theme].plate }));
  plate.position.z = -0.05;
  map.add(plate);

  const byCode = new Map<string, { column: ColumnMesh; record: FakeMunicipalityRecord }>();
  const recordByCode = new Map(dataset.records.map((r) => [r.code, r]));
  for (const column of columns) {
    const record = recordByCode.get(column.code);
    if (!record) continue; // a boundary without a record is simply not drawn — never a made-up number
    byCode.set(column.code, { column, record });
    map.add(column.mesh);
  }

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !opts.reducedMotion;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // never below the plate
  controls.minDistance = 80;
  controls.maxDistance = 700;
  controls.target.set(0, 0, 0);

  let theme = opts.theme;
  const reduced = opts.reducedMotion;
  let year = YEAR_START;
  let filter: MunicipalityType | 'all' = 'all';
  let highlighted: string | null = null;

  const targets = new Map<string, number>();
  const tweenFrom = new Map<string, number>();
  let tweenStart = 0;
  let tweening = false;
  let frame: number | null = null;
  let dirty = true;

  const applyColours = (): void => {
    for (const [code, { column, record }] of byCode) {
      const dim = filter !== 'all' && record.type !== filter;
      const m = column.mesh.material;
      m.color.set(growthColor(growthSince(record, year), theme));
      m.transparent = dim;
      m.opacity = dim ? 0.15 : 1;
      m.emissive.set(code === highlighted ? '#ffffff' : '#000000');
      m.emissiveIntensity = code === highlighted ? 0.35 : 0;
      m.needsUpdate = true;
    }
  };

  const tick = (now: number): void => {
    frame = null;
    let keepGoing = false;
    if (tweening) {
      const t = Math.min(1, (now - tweenStart) / HEIGHT_TWEEN_MS);
      const eased = 1 - (1 - t) ** 3;
      for (const [code, { column }] of byCode) {
        const from = tweenFrom.get(code) ?? MIN_HEIGHT;
        const to = targets.get(code) ?? MIN_HEIGHT;
        column.mesh.scale.z = from + (to - from) * eased;
      }
      tweening = t < 1;
      keepGoing = tweening;
      dirty = true;
    }
    if (controls.enableDamping && controls.update()) {
      dirty = true;
      keepGoing = true;
    }
    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
    if (keepGoing) frame = requestAnimationFrame(tick);
  };
  const invalidate = (): void => {
    dirty = true;
    if (frame === null) frame = requestAnimationFrame(tick);
  };
  controls.addEventListener('change', invalidate);

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const meshes = [...byCode.values()].map((v) => v.column.mesh);

  const handle: SceneHandle = {
    setYear(y, animate) {
      year = y;
      for (const [code, { column, record }] of byCode) {
        tweenFrom.set(code, column.mesh.scale.z);
        targets.set(code, heightFor(populationIn(record, y), dataset.maxPopulation));
      }
      applyColours();
      if (animate && !reduced) {
        tweenStart = performance.now();
        tweening = true;
      } else {
        for (const [code, { column }] of byCode) column.mesh.scale.z = targets.get(code) ?? MIN_HEIGHT;
        tweening = false;
      }
      invalidate();
    },
    setTheme(t) {
      theme = t;
      plate.material.color.set(SCENE_COLORS[t].plate);
      hemi.intensity = t === 'dark' ? 0.7 : 1.0;
      applyColours();
      invalidate();
    },
    setFilter(f) {
      filter = f;
      applyColours();
      invalidate();
    },
    setHighlight(code) {
      highlighted = code;
      applyColours();
      invalidate();
    },
    pick(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      const data = hit?.object.userData as { code?: string } | undefined;
      return data?.code ?? null;
    },
    resetView() {
      camera.position.copy(CAMERA_HOME);
      controls.target.set(0, 0, 0);
      controls.update();
      invalidate();
    },
    resize() {
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      invalidate();
    },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      controls.removeEventListener('change', invalidate);
      controls.dispose();
      for (const { column } of byCode.values()) {
        column.mesh.geometry.dispose();
        column.mesh.material.dispose();
      }
      plate.geometry.dispose();
      plate.material.dispose();
      renderer.dispose();
    },
  };

  handle.resize();
  handle.setYear(YEAR_START, false);
  return handle;
}
```

- [ ] **Step 4: Run** → PASS; `cd web && npx tsc --noEmit` clean (this is the task where `@types/three`'s `three/addons/*` declarations must resolve — if `OrbitControls` types are missing, the `@types/three` minor does not match `three`'s; align them, do not add a `declare module`).
- [ ] **Step 5: Commit**
```bash
git add web/app/bevolking-3d-demo/scene.ts web/app/bevolking-3d-demo/scene.test.ts
git commit -m "feat(demo): WebGL scene — on-demand render loop, height tween, orbit controls, raycast pick, theme, dispose (ADR 049)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `DemoBanner`, the `Map3d` client component, the strings, the honesty locks
**Files:** Create `web/app/bevolking-3d-demo/demo-banner.tsx`, `web/app/bevolking-3d-demo/map3d.tsx`, `web/app/bevolking-3d-demo/map3d.test.tsx`; modify `web/lib/i18n/messages.ts`

**Strings (add to `nl` at the end of the table, and the matching `en` entries — `Messages` is derived from `nl`, so a missing English key is a compile error):**
```ts
// --- ADR 049: /bevolking-3d-demo — the 3D municipality DEMO. Every number on that page is fiction; these labels say so. ---
'lab3d.pageTitle': 'Demo: 3D-gemeentekaart (fictieve data) — Check de Cijfers',
'lab3d.title': 'Nederland groeit, maar niet overal',
'lab3d.intro': 'Een demonstratie van een 3D-kaart: elke gemeente is een kolom, de hoogte staat voor het aantal inwoners en de kleur voor de groei sinds het startjaar. Alle cijfers zijn verzonnen; alleen de gemeentegrenzen en -namen zijn echt.',
'lab3d.badge': 'DEMO — FICTIEVE DATA',
'lab3d.badgeDetail': 'Elke waarde op deze pagina is verzonnen, alleen ter demonstratie. Dit is geen CBS-cijfer.',
'lab3d.watermark': 'FICTIEF',
'lab3d.footer': 'Cijfers: fictief, alleen ter demonstratie. Gemeentegrenzen: CBS/PDOK via cartomap.github.io, licentie CC BY 4.0.',
'lab3d.mapLabel': '3D-kaart van gemeenten (fictieve data)',
'lab3d.year': 'Jaar',
'lab3d.play': 'Afspelen',
'lab3d.pause': 'Pauzeren',
'lab3d.resetView': 'Herstel weergave',
'lab3d.typeLabel': 'Gemeentetype',
'lab3d.typeAll': 'Alle gemeenten',
'lab3d.typeCity': 'Stad',
'lab3d.typeMid': 'Middelgroot',
'lab3d.typeRural': 'Landelijk',
'lab3d.pickLabel': 'Gemeente',
'lab3d.pickNone': 'Kies een gemeente',
'lab3d.population': 'Inwoners (fictief)',
'lab3d.growth': 'Groei sinds startjaar (fictief)',
'lab3d.legendLow': 'krimp',
'lab3d.legendHigh': 'groei',
'lab3d.heightNote': 'Hoogte = inwoners (fictief) · kleur = groei (fictief)',
'lab3d.loading': 'Kaart laden…',
'lab3d.unavailable': 'Deze browser kan geen 3D tonen (WebGL ontbreekt).',
'lab3d.loadFailed': 'De gemeentegrenzen konden niet worden geladen.',
```
English entries, same keys in the same order: 'Demo: 3D municipality map (fictional data) — Check de Cijfers' / 'The Netherlands is growing, but not everywhere' / 'A demonstration of a 3D map: every municipality is a column, height stands for population and colour for growth since the start year. Every figure is made up; only the municipal boundaries and names are real.' / 'DEMO — FICTIONAL DATA' / 'Every value on this page is made up, for demonstration only. This is not a CBS figure.' / 'FICTIONAL' / 'Figures: fictional, for demonstration only. Municipal boundaries: CBS/PDOK via cartomap.github.io, licence CC BY 4.0.' / '3D map of municipalities (fictional data)' / 'Year' / 'Play' / 'Pause' / 'Reset view' / 'Municipality type' / 'All municipalities' / 'City' / 'Mid-sized' / 'Rural' / 'Municipality' / 'Choose a municipality' / 'Population (fictional)' / 'Growth since start year (fictional)' / 'shrinking' / 'growth' / 'Height = population (fictional) · colour = growth (fictional)' / 'Loading map…' / 'This browser cannot show 3D (no WebGL).' / 'The municipal boundaries could not be loaded.'

**Interfaces:**
```ts
// demo-banner.tsx — a Server-Component-compatible file (no 'use client'), so the PAGE renders it in the HTML before any JS.
export function DemoBanner({ lang }: { lang: Lang }): ReactNode; // <div role="note" data-demo-banner> with t('lab3d.badge') in a <strong> and t('lab3d.badgeDetail'); NO other prop exists.
// map3d.tsx
'use client';
export const TOPOJSON_URL = '/demo/gemeente_2024.topojson';
export const PLAY_INTERVAL_MS = 600;
export function Map3d({ lang }: { lang: Lang }): ReactNode;
```

- [ ] **Step 1: Write the failing tests** — `web/app/bevolking-3d-demo/map3d.test.tsx`:
```tsx
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../lib/i18n/messages.ts';
import { DemoBanner } from './demo-banner.tsx';
import { YEAR_END, YEAR_START } from './fake-data.ts';
import { Map3d, TOPOJSON_URL } from './map3d.tsx';
import { TWO_SQUARES_TOPOLOGY } from './test-fixture.ts';

function stubMatchMedia(reduced: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: reduced && query.includes('prefers-reduced-motion'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}
async function renderLoaded(lang: 'nl' | 'en' = 'nl') {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => TWO_SQUARES_TOPOLOGY }));
  vi.stubGlobal('fetch', fetchMock);
  const view = render(<Map3d lang={lang} />);
  await screen.findByRole('status'); // 'unavailable' in jsdom — the data loaded, the scene did not
  expect(fetchMock).toHaveBeenCalledWith(TOPOJSON_URL);
  return view;
}
/** The demo's own honesty scan: every digit-bearing text node must sit under
 * data-fictional (a fake number, labelled) or data-year (a calendar year). */
function scanDigits(container: HTMLElement): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!/\d/.test(node.textContent ?? '')) continue;
    seen++;
    const el = node.parentElement;
    expect(el?.closest('[data-fictional="true"], [data-year]'), `digit "${node.textContent}" outside a labelled element`).not.toBeNull();
  }
  expect(seen).toBeGreaterThan(0);
}

beforeEach(() => stubMatchMedia(false));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('DemoBanner — the page-level label (ADR 049)', () => {
  it('renders the fixed badge text and the explanation, in both languages, as a note', () => {
    for (const lang of ['nl', 'en'] as const) {
      const { unmount } = render(<DemoBanner lang={lang} />);
      const note = screen.getByRole('note');
      expect(note.textContent).toContain(t(lang, 'lab3d.badge'));
      expect(note.textContent).toContain(t(lang, 'lab3d.badgeDetail'));
      unmount();
    }
    expect(t('nl', 'lab3d.badge')).toBe('DEMO — FICTIEVE DATA');
    expect(t('en', 'lab3d.badge')).toBe('DEMO — FICTIONAL DATA');
  });
  it('has no prop that could hide it (compile-time pin)', () => {
    // @ts-expect-error — DemoBanner accepts `lang` only; a `hidden`-style prop must not exist.
    expect(() => render(<DemoBanner lang="nl" hidden />)).not.toThrow();
  });
});

describe('Map3d — labels, controls and the digit lock (ADR 049)', () => {
  it('always shows the watermark and the height/colour note; in jsdom it reports 3D as unavailable but still loads the data', async () => {
    const { container } = await renderLoaded();
    expect(container.querySelector('[data-watermark][aria-hidden="true"]')?.textContent).toContain(t('nl', 'lab3d.watermark'));
    expect(screen.getByRole('status').textContent).toBe(t('nl', 'lab3d.unavailable'));
    expect(container.textContent).toContain(t('nl', 'lab3d.heightNote'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining(['Aa', 'Bee']));
  });
  it('choosing a municipality shows its (fictional) numbers, every one labelled; the digit scan passes', async () => {
    const { container } = await renderLoaded();
    fireEvent.change(screen.getByLabelText(t('nl', 'lab3d.pickLabel')), { target: { value: 'GM0002' } });
    const details = container.querySelector('[aria-live="polite"][data-fictional="true"]');
    expect(details?.textContent).toContain('Bee');
    expect(details?.textContent).toContain(t('nl', 'lab3d.population'));
    expect(details?.textContent).toContain(t('nl', 'lab3d.growth'));
    expect(details?.textContent).toContain(t('nl', 'lab3d.badge'));
    scanDigits(container);
  });
  it('the year slider spans 1995–2025 and play advances one year per tick, stopping at the end', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = await renderLoaded();
    const slider = screen.getByLabelText(t('nl', 'lab3d.year')) as HTMLInputElement;
    expect(slider.min).toBe(String(YEAR_START));
    expect(slider.max).toBe(String(YEAR_END));
    expect(container.querySelector('[data-year]')?.textContent).toBe(String(YEAR_START));
    fireEvent.change(slider, { target: { value: String(YEAR_END - 1) } });
    const play = screen.getByRole('button', { name: t('nl', 'lab3d.play') });
    fireEvent.click(play);
    expect(play).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(container.querySelector('[data-year]')?.textContent).toBe(String(YEAR_END));
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(screen.getByRole('button', { name: t('nl', 'lab3d.play') })).toHaveAttribute('aria-pressed', 'false');
    scanDigits(container);
  });
  it('reduced motion is read once at mount (no tween, no damping) and the controls still work', async () => {
    stubMatchMedia(true);
    const { container } = await renderLoaded();
    expect(container.querySelector('[data-reduced-motion="true"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('nl', 'lab3d.resetView') }));
  });
  it('a failed asset fetch is an honest message, never an empty map', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    render(<Map3d lang="en" />);
    expect((await screen.findByRole('status')).textContent).toBe(t('en', 'lab3d.loadFailed'));
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd web && npx vitest run app/bevolking-3d-demo/map3d.test.tsx` → FAIL.

- [ ] **Step 3: Implement** `web/app/bevolking-3d-demo/demo-banner.tsx`:
```tsx
// ADR 049: the always-on "this is fiction" label. Deliberately a plain
// component with NO 'use client' and NO prop other than `lang`, rendered by
// the PAGE (server) above the 3D loader — it is in the HTML before any
// JavaScript runs and survives a failed or slow 3D chunk. map3d.test.tsx
// pins that no prop exists that could hide it.
import type { ReactNode } from 'react';
import { t, type Lang } from '../../lib/i18n/messages.ts';

export function DemoBanner({ lang }: { lang: Lang }): ReactNode {
  return (
    <div role="note" data-demo-banner="true" className="rounded-md border-2 border-warning bg-warning/10 px-4 py-3 text-foreground">
      <strong className="block text-sm font-bold uppercase tracking-wide">{t(lang, 'lab3d.badge')}</strong>
      <span className="mt-1 block text-sm">{t(lang, 'lab3d.badgeDetail')}</span>
    </div>
  );
}
```
  (Verify `warning` exists as a colour token in `web/app/globals.css` — `docs/12-huisstijl.md` rule 5 uses `text-warning`; if the utility is named differently there, use THAT token, never a literal.)

- [ ] **Step 4: Implement** `web/app/bevolking-3d-demo/map3d.tsx` (client; the DOM chrome renders regardless of WebGL — only the canvas needs it):
```tsx
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
import { buildColumns } from './columns.ts';
import { buildFakeDataset, growthSince, populationIn, YEAR_END, YEAR_START, type FakeDataset, type FakeMunicipalityRecord, type MunicipalityType } from './fake-data.ts';
import { formatGrowth, formatPopulation, GROWTH_HIGH_HEX, GROWTH_LOW_HEX, type Theme } from './scales.ts';
import { createScene, type SceneHandle } from './scene.ts';
import { areaKm2, decodeMunicipalities } from './topojson.ts';

export const TOPOJSON_URL = '/demo/gemeente_2024.topojson';
export const PLAY_INTERVAL_MS = 600;

type Status = 'loading' | 'ready' | 'unavailable' | 'failed';
type Filter = MunicipalityType | 'all';

function Details({ record, year, lang }: { record: FakeMunicipalityRecord; year: number; lang: Lang }): ReactNode {
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
        const scene = canvas ? createScene(canvas, buildColumns(features), data, { theme, reducedMotion: reducedAtMount.current }) : null;
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

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-muted-foreground">
          {t(lang, 'lab3d.year')}
          <span className="flex items-center gap-2">
            <input type="range" min={YEAR_START} max={YEAR_END} step={1} value={year} aria-valuetext={String(year)} onChange={(e) => { setPlaying(false); setYear(Number(e.target.value)); }} className="w-56" />
            <output data-year="true" className="tnum text-base font-semibold text-foreground">{year}</output>
          </span>
        </label>
        <Button type="button" variant="outline" size="sm" aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>
          {t(lang, playing ? 'lab3d.pause' : 'lab3d.play')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => sceneRef.current?.resetView()}>{t(lang, 'lab3d.resetView')}</Button>
        <label className="flex flex-col text-xs text-muted-foreground">
          {t(lang, 'lab3d.typeLabel')}
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground">
            <option value="all">{t(lang, 'lab3d.typeAll')}</option>
            <option value="city">{t(lang, 'lab3d.typeCity')}</option>
            <option value="mid">{t(lang, 'lab3d.typeMid')}</option>
            <option value="rural">{t(lang, 'lab3d.typeRural')}</option>
          </select>
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          {t(lang, 'lab3d.pickLabel')}
          <select value={pinned ?? ''} onChange={(e) => setPinned(e.target.value || null)} className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground">
            <option value="">{t(lang, 'lab3d.pickNone')}</option>
            {[...records].sort((a, b) => a.name.localeCompare(b.name, 'nl')).map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
          </select>
        </label>
      </div>

      <p data-fictional="true" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{t(lang, 'lab3d.legendLow')}</span>
        <span aria-hidden="true" className="h-2 w-40 rounded" style={{ background: `linear-gradient(90deg, ${GROWTH_LOW_HEX}, transparent 50%, ${GROWTH_HIGH_HEX})` }} />
        <span>{t(lang, 'lab3d.legendHigh')}</span>
      </p>
      <div aria-live="polite" data-fictional="true" className="mt-2 min-h-6 rounded-md border border-border bg-card p-2 text-card-foreground">
        {shown ? <Details record={shown} year={year} lang={lang} /> : null}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t(lang, 'lab3d.heightNote')}</p>
    </section>
  );
}
```
  Notes: `useMediaQuery` is `useSyncExternalStore`-based (`web/lib/use-media-query.ts:11`) and safe under the stubbed `matchMedia`; the legend gradient's `transparent 50%` midpoint lets the card colour show through so it is theme-correct without a literal; `popover`/`warning` tokens must exist in `globals.css` — check, and substitute the repo's actual token names if they differ.

- [ ] **Step 5: Run** the demo tests + `cd web && npx vitest run lib/i18n` (any catalogue pins) → PASS; both typechecks clean.
- [ ] **Step 6: Commit**
```bash
git add web/app/bevolking-3d-demo/demo-banner.tsx web/app/bevolking-3d-demo/map3d.tsx web/app/bevolking-3d-demo/map3d.test.tsx web/lib/i18n/messages.ts
git commit -m "feat(demo): 3D municipality map component — banner, watermark, slider/play, filter, pick, details; digit lock (ADR 049)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The dynamic loader, the page, and the isolation pins
**Files:** Create `web/app/bevolking-3d-demo/map3d-loader.tsx`, `web/app/bevolking-3d-demo/page.tsx`, `web/app/bevolking-3d-demo/page.test.tsx`, `web/app/bevolking-3d-demo/isolation.test.ts`

- [ ] **Step 1: Write the failing page tests** — `web/app/bevolking-3d-demo/page.test.tsx` (mirror `web/app/galerij/page.test.tsx`'s mocks for `getLang` and `SiteHeader`; mock the loader to a stub so `next/dynamic` never runs in jsdom):
```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../lib/i18n/messages.ts';
import { isPublicPath } from '../../proxy.ts';

const lang = vi.hoisted(() => ({ current: 'nl' as 'nl' | 'en' }));
vi.mock('../../lib/i18n/server.ts', () => ({ getLang: async () => lang.current }));
vi.mock('../../components/site-header.tsx', () => ({ SiteHeader: () => <header data-testid="header" /> }));
vi.mock('./map3d-loader.tsx', () => ({ Map3dLoader: () => <div data-testid="loader" /> }));

import Bevolking3dDemoPage, { generateMetadata } from './page.tsx';

afterEach(() => { cleanup(); lang.current = 'nl'; });

describe('/bevolking-3d-demo page (ADR 049)', () => {
  it('is noindexed and titled as a demo with fictional data, in both languages', async () => {
    expect(await generateMetadata()).toMatchObject({ title: t('nl', 'lab3d.pageTitle'), robots: { index: false, follow: false } });
    lang.current = 'en';
    expect(await generateMetadata()).toMatchObject({ title: t('en', 'lab3d.pageTitle'), robots: { index: false, follow: false } });
    expect(t('nl', 'lab3d.pageTitle').toLowerCase()).toContain('demo');
    expect(t('en', 'lab3d.pageTitle').toLowerCase()).toContain('fictional');
  });
  it('renders the banner in the server HTML above the loader, and the fictional footer line', async () => {
    const { container } = render(await Bevolking3dDemoPage());
    const note = screen.getByRole('note');
    expect(note.textContent).toContain(t('nl', 'lab3d.badge'));
    const order = [...container.querySelectorAll('[role="note"], [data-testid="loader"]')];
    expect(order[0]).toBe(note);
    expect(container.textContent).toContain(t('nl', 'lab3d.footer'));
  });
  it('is behind the login by default — the route and its asset are NOT public paths', () => {
    expect(isPublicPath('/bevolking-3d-demo')).toBe(false);
    expect(isPublicPath('/demo/gemeente_2024.topojson')).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing isolation tests** — `web/app/bevolking-3d-demo/isolation.test.ts`:
```ts
// ADR 049: the structural pins that keep the demo OUT of the product —
// grep-as-a-test, the tests/docs/doc-conventions.test.ts discipline.
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('../..', import.meta.url));
const DEMO = fileURLToPath(new URL('.', import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (lstatSync(full).isSymbolicLink()) continue; // web/backend → ../src: never walk into the product
    if (entry === 'node_modules' || entry === '.next') continue;
    if (lstatSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}
const outside = [...sources(join(WEB, 'app')), ...sources(join(WEB, 'components')), ...sources(join(WEB, 'lib')), join(WEB, 'proxy.ts')].filter((f) => !f.startsWith(DEMO));
const inside = sources(DEMO);
const read = (f: string): string => readFileSync(f, 'utf8');

describe('bundle isolation — three lives only in this directory, behind one dynamic import', () => {
  it('no file outside the demo directory imports three', () => {
    for (const f of outside) expect(read(f), relative(WEB, f)).not.toMatch(/from\s+['"]three(\/|['"])/);
  });
  it('the loader is the ONLY reference to map3d.tsx, and it is a dynamic import; page.tsx never imports three-touching modules statically', () => {
    const loader = read(join(DEMO, 'map3d-loader.tsx'));
    expect(loader).toMatch(/import\(\s*['"]\.\/map3d\.tsx['"]\s*\)/);
    expect(loader).not.toMatch(/^import .* from ['"]\.\/map3d\.tsx['"]/m);
    const page = read(join(DEMO, 'page.tsx'));
    for (const m of ['map3d.tsx', 'scene.ts', 'columns.ts']) expect(page).not.toContain(`./${m}`);
    for (const f of inside.filter((f) => !/map3d-loader\.tsx$|\.test\.tsx?$/.test(f))) expect(read(f), relative(WEB, f)).not.toMatch(/from ['"]\.\/map3d\.tsx['"]/);
  });
});

describe('product isolation — no real data, no pipeline, no LLM, no live external call', () => {
  it('nothing in the demo directory reaches the backend, the database, the Anthropic SDK, a server action or an http(s) URL', () => {
    for (const f of inside) {
      const src = read(f);
      const name = relative(WEB, f);
      expect(src, name).not.toMatch(/backend\//);
      expect(src, name).not.toMatch(/lib\/db\.ts/);
      expect(src, name).not.toMatch(/@anthropic-ai/);
      expect(src, name).not.toMatch(/['"]use server['"]/);
      expect(src, name).not.toMatch(/fetch\(\s*['"`]https?:/);
    }
  });
});

describe('undiscoverable — nothing links here', () => {
  it('the route string appears nowhere outside its own directory', () => {
    for (const f of outside) expect(read(f), relative(WEB, f)).not.toContain('bevolking-3d-demo');
  });
});
```

- [ ] **Step 3: Run both** → FAIL (files missing).

- [ ] **Step 4: Implement** `web/app/bevolking-3d-demo/map3d-loader.tsx`:
```tsx
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
```
  and `web/app/bevolking-3d-demo/page.tsx`:
```tsx
// /bevolking-3d-demo — ADR 049: a DEMO of a 3D municipality map over
// FICTIONAL numbers. Not part of the product: not linked anywhere, noindexed
// (belt-and-suspenders next to the site-wide pre-launch noindex in
// layout.tsx and robots.ts), behind the login by default (not in
// proxy.ts's PUBLIC_EXACT_PATHS — open-questions #250 if that should change),
// no env flag (unlike the Eurostat explorer, this page is MEANT to be shown
// from production by the signed-in owner). Zero backend imports, zero LLM,
// zero audit rows, zero live external calls — pinned by isolation.test.ts.
// The banner below is server-rendered so the label exists before any JS.
import type { Metadata } from 'next';
import { SiteHeader } from '../../components/site-header.tsx';
import { t } from '../../lib/i18n/messages.ts';
import { getLang } from '../../lib/i18n/server.ts';
import { DemoBanner } from './demo-banner.tsx';
import { Map3dLoader } from './map3d-loader.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLang(), 'lab3d.pageTitle'), robots: { index: false, follow: false } };
}

export default async function Bevolking3dDemoPage() {
  const lang = await getLang();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader stripped />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <DemoBanner lang={lang} />
        <h1 className="mt-6 text-2xl text-foreground">{t(lang, 'lab3d.title')}</h1>
        <p className="mt-2 max-w-xl text-muted-foreground">{t(lang, 'lab3d.intro')}</p>
        <div className="mt-6"><Map3dLoader lang={lang} /></div>
        <p className="mt-6 border-t border-border pt-3 text-xs text-muted-foreground">{t(lang, 'lab3d.footer')}</p>
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Run** `cd web && npx vitest run app/bevolking-3d-demo` → all PASS; `npx vitest run proxy.test.ts app/galerij` unchanged; both typechecks clean; `npm run web:build` (root) succeeds and lists `/bevolking-3d-demo`.
- [ ] **Step 6: Commit**
```bash
git add web/app/bevolking-3d-demo/map3d-loader.tsx web/app/bevolking-3d-demo/page.tsx web/app/bevolking-3d-demo/page.test.tsx web/app/bevolking-3d-demo/isolation.test.ts
git commit -m "feat(demo): /bevolking-3d-demo page — noindex, login-gated, dynamic 3D chunk; bundle/product/discoverability isolation pins (ADR 049)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## After the tasks (controller)
1. **Whole-branch review (top tier):** the fake generator's name-blindness and non-tuning; every number-bearing element under `data-fictional`; the banner is server-rendered and prop-less; `three` reachable only via the dynamic import; dispose on unmount; no `aspect-ratio`; tokens only in DOM chrome; `git diff --stat main -- src/ tests/ benchmark/ migrations/` is EMPTY (the one-line proof the answer pipeline, the benchmark and the invariant suites are untouched — the reviewer runs it and quotes it in the PR).
2. **Bundle measurement (record, do not assert):** on `main`, `npm run web:build` → note "First Load JS" for `/`, `/galerij`, `/geschiedenis`; on the branch, the same three (must be identical) plus `/bevolking-3d-demo` and the largest new file in `web/.next/static/chunks/` (`ls -S web/.next/static/chunks | head -3`, gzip it with `gzip -c … | wc -c`). Write all numbers into ADR 049. Ceiling 250 kB gzipped for the route-private chunk; above it, stop and report.
3. **Verification block:** root `npx tsc --noEmit`; `cd web && npx tsc --noEmit`; `npm test` (root, all backend suites — unchanged by construction); `npm run web:test`; `npm run benchmark:run && npm run benchmark:score` (14/14 + 6/6 + 0 fabricated — unaffected, still run, still quoted); `npm run test:docs`; `npm run web:build`; `/code-review` at LOW over the diff.
4. **Real browser pass** on the dev server (`.claude/launch.json` → `web`; a signed-in session is required because the route is login-gated — if no dev login is available autonomously, list the pass as the owner's review step in the PR): map renders; slider + play/pause; type filter dims; hover tooltip and click-pin; select-a-municipality details; reset view; light AND dark theme; `prefers-reduced-motion` emulation (no tween, no damping); 1280 px and 375 px; the watermark visible in a screenshot; the banner visible without scrolling. Screenshots for the PR.
5. **Docs:** ADR 049 "3D municipality map demo over fictional data" (context incl. ADR 044's kickoff ruling; decisions: demo-only, one-library exception, placement, gating, labelling locks, measured bundle numbers; alternatives: `topojson-client`, `@react-three/fiber`, public route, env flag; revisit triggers: a real version needs an "every region's value" query capability the pipeline does not have AND must re-answer the 3D-distortion and WebGL-invisible-to-honesty-scans objections in its own ADR); `docs/08-build-plan.md` entry (demo, out of product flow); `docs/12-huisstijl.md` rule 1 (the `scales.ts` literals as a sanctioned spot); `docs/04-architecture.md` one row; `docs/open-questions.md` #250 (public vs login-gated), #251 (asset property-key assumption + CC BY attribution wording for boundaries); `web/README.md` one line; STATUS/archive/lessons per the wrap-up ritual. PR from `demo-3d-municipality-map` per #118(b).

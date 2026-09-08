# WP218 Phase 3 — Brand Colours & Fonts (Brandfetch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An "Apply brand colours" action in the chart style panel that looks up the signed-in user's organisation brand (colours + font) through the Brandfetch Brand API — by the login email's domain, with a website box when that domain is a free-mail provider — applies it to the chart through the existing colour/font overrides (with the R11 colour guard), and shows an attribution line.

**Architecture:** A pure parser + fetch client in `src/chart/brandfetch.ts` (zod-validated payload, typed failure reasons, injectable `fetch`), a per-domain cache table (`brand_cache`, 30-day TTL — Brandfetch's terms allow storing results for at most 30 days) and a per-user daily lookup cap stored in the phase-2 `user_chart_styles.brand` column, one server action `lookupBrand(website?)` in `web/app/chart-style-actions.ts`, and a "Merkkleuren" block in the panel's Kleuren tab that calls it and applies the result as ordinary `seriesColors` + `fontFamily` overrides. Without `BRANDFETCH_API_KEY` in the environment the block explains that brand lookup is not available; nothing else changes. Owner decision B (session 90) on open-questions #218 ("whatever, it needs to work").

**Facts (from `.superpowers/sdd/brandfetch-research.md`, 2026-09-09):** endpoint `GET https://api.brandfetch.io/v2/brands/{domain}` (the docs also show `/v2/brands/domain/{domain}` — the implementer checks the current reference page and uses the documented one, the path is one constant) with `Authorization: Bearer <API key>`; colours `{ hex, type: 'accent'|'dark'|'light'|'brand', brightness }`, fonts `{ name, type: 'title'|'body', origin: 'google'|'custom'|'system', originId }`; 404 unknown domain, 401 bad key, 429 quota/rate; free tier = 100 lookups total (no card), first paid tier ≈ $99/month for 2 500 lookups (UNCONFIRMED whether $99 or $129 — the owner re-checks on the pricing page before paying); results may be cached server-side for ≤ 30 days.

**Tech Stack:** Node `fetch`, zod ^4 (root project), Postgres/PGlite, Next.js server actions, React 19.

## Global Constraints

- **No key, no calls:** every path checks `process.env.BRANDFETCH_API_KEY`; absent → `{ ok: false, reason: 'unavailable' }` and the panel copy `Merkkleuren ophalen is op dit moment niet mogelijk.` The key is a Vercel secret the OWNER sets (RUNBOOK secrets table row + supervised step); the session never sets secrets.
- **Spend control:** one API call per domain per 30 days (cache hit otherwise); at most 5 lookups per user per day (counter in `user_chart_styles.brand.lookups`, deploy-order safe: if the table is absent the lookup is refused with `unavailable`); signed-in users only; the domain is validated (`normalizeDomain`) before any call — never an arbitrary URL.
- **Honesty guard unchanged:** brand colours pass through `judgeColor` on the client; refused ones are skipped (the palette colour stays for that series); the hollow R11 ring can never vanish. Brand fonts: a Google-origin font is applied by family name (loaded on demand by the existing `ensureFontLoaded`); a `system`-origin name is applied as-is; `custom` fonts cannot be loaded and are skipped (the copy says so).
- **Migration 029 is FILE-ONLY** until the supervised apply (it can ride the same `npm run db:migrate` as 028). `brand_cache` holds public brand facts keyed by domain — not personal data; the `user_chart_styles.brand` field IS in the user's personal row and goes with it on every delete/purge path phase 2 built (nothing extra to wire, verify with a test).
- **Digit-free panel copy** in `PANEL_COPY` nl + en; hex codes only in inputs. Tokens not colours. `src/` never imports `web/`.
- Tests: `tests/chart/*` for `src/chart/*` (`npm run test:chart`, solo), co-located for web (`cd web && npm test`). Commit only on `wp218-chart-styling`, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: `src/chart/brandfetch.ts` — parser, domain rules, fetch client

**Files:** create `src/chart/brandfetch.ts`, `tests/chart/brandfetch.test.ts`.

**Interfaces produced:**

```ts
export interface BrandInfo {
  name: string;
  domain: string;
  colors: { hex: string; type: 'brand' | 'accent' | 'dark' | 'light' | 'other' }[]; // hex lowercase '#rrggbb'
  fonts: { family: string; role: 'title' | 'body' | 'other'; origin: 'google' | 'custom' | 'system' }[];
}
export type BrandLookupFailure = 'not_found' | 'unauthorized' | 'rate_limited' | 'unavailable' | 'invalid_domain';
export type BrandLookupResult = { ok: true; brand: BrandInfo } | { ok: false; reason: BrandLookupFailure };
export const BRANDFETCH_ENDPOINT = 'https://api.brandfetch.io/v2/brands/'; // + domain (verify path form against the docs)
export function normalizeDomain(input: string): string | null;   // 'https://WWW.Example.nl/x' → 'example.nl'; strips scheme/path/port/leading www.; lowercases; rejects empty, spaces, localhost, IP literals, no dot, >253 chars, non-[a-z0-9.-]
export const FREE_MAIL_DOMAINS: readonly string[];               // gmail.com, googlemail.com, hotmail.com, hotmail.nl, outlook.com, live.nl, live.com, yahoo.com, yahoo.nl, icloud.com, me.com, ziggo.nl, kpnmail.nl, kpnplanet.nl, home.nl, casema.nl, hetnet.nl, planet.nl, xs4all.nl, protonmail.com, proton.me, mail.com, gmx.com, gmx.net
export function isFreeMailDomain(domain: string): boolean;
export function parseBrandPayload(json: unknown, domain: string): BrandInfo | null; // zod, tolerant: unknown types → 'other', bad hex dropped, missing arrays → []
export function pickBrandColours(brand: BrandInfo): string[];     // order: brand, accent, dark, light, other; de-duplicated; max 8
export function pickBrandFont(brand: BrandInfo): { family: string; origin: 'google' | 'system' } | null; // body google → title google → body system → title system → null (custom skipped); family must match /^[A-Za-z0-9 ]{1,40}$/
export async function fetchBrand(domain: string, deps: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<BrandLookupResult>; // GET with Bearer; 200 → parse (null → 'unavailable'); 404 → not_found; 401/403 → unauthorized; 429 → rate_limited; other/network/timeout → unavailable; never throws
```

Tests: normalizeDomain table (10 cases incl. rejects); free-mail yes/no; parse a realistic payload (copy the field names above into a fixture with 3 colours + 2 fonts) → typed result, junk → null, hex uppercase → lowercase, unknown colour type → 'other'; pickBrandColours order + dedupe + cap; pickBrandFont preference ladder incl. custom skipped and an invalid family name skipped; fetchBrand with a stub `fetchImpl` returning 200/404/401/429/500, a rejecting fetch, and an aborted timeout — assert the Authorization header and URL on the stub call.

Commit `feat(chart): Brandfetch client — domain rules, payload parser, typed lookup (WP218 phase 3)`.

---

### Task 2: Migration 029 + brand cache + per-user lookup cap

**Files:** create `migrations/029_brand_cache.sql`, `src/chart/brand-cache.ts`, `tests/chart/brand-cache.test.ts`; modify `src/chart/user-styles.ts` (+ test) for the lookup counter.

```sql
-- 029 — brand_cache (WP218 phase 3, ADR 039). ⚠ FILE-ONLY until the supervised
-- apply (ride the same npm run db:migrate as 028). Public brand facts keyed by
-- domain, fetched from Brandfetch; kept ≤ 30 days (Brandfetch terms) — the
-- reader treats older rows as absent. Not personal data (no user column).
create table brand_cache (
  domain text primary key check (domain ~ '^[a-z0-9.-]{1,253}$'),
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
```

```ts
export const BRAND_CACHE_TTL_DAYS = 30;
export async function getCachedBrand(db: Db, domain: string, now: Date): Promise<BrandInfo | null>; // null when absent, expired (> TTL), unparsable, or table absent
export async function putCachedBrand(db: Db, domain: string, brand: BrandInfo, now: Date): Promise<void>; // upsert; silent no-op when table absent
export async function purgeExpiredBrandCache(db: Db, now: Date): Promise<number>; // deletes rows older than TTL — called opportunistically by putCachedBrand (cheap, keeps the table small; no cron leg needed since it is not personal data)
// user-styles.ts additions
export const BRAND_LOOKUPS_PER_DAY = 5;
export async function bumpBrandLookups(db: Db, userId: string, day: string /* YYYY-MM-DD */): Promise<{ allowed: boolean; count: number }>; // reads brand.lookups from the user's row (creating the row with style '{}' if missing), resets when day differs, refuses at the cap; unavailable table → { allowed: false, count: 0 }
export async function setAppliedBrand(db: Db, userId: string, applied: { domain: string; name: string; fetchedAt: string } | null): Promise<void>; // merges into brand.applied
```

Tests (hermetic DB): cache miss → put → hit; expired → null; junk payload → null; absent table → null / no-throw; lookups: five allowed, sixth refused, next day resets; `setAppliedBrand` merges without touching `lookups`; `deleteUserChartStyle` removes the brand field with the row (phase-2 delete path covers it — assert).

Commit `feat(chart): brand cache (migration 029, file-only) + per-user daily lookup cap (WP218 phase 3)`.

---

### Task 3: Server action `lookupBrand`

**Files:** modify `web/app/chart-style-actions.ts` (created in phase 2; if it does not exist yet create it as `'use server'`), `web/app/chart-style-actions.test.ts`.

```ts
export type LookupBrandResponse =
  | { ok: true; brand: { name: string; domain: string; colors: string[]; font: { family: string; origin: 'google' | 'system' } | null; fetchedAt: string; cached: boolean } }
  | { ok: false; reason: 'unauthenticated' | 'unavailable' | 'need_website' | 'invalid_domain' | 'not_found' | 'rate_limited' | 'daily_cap' | 'error' };
export async function lookupBrand(rawWebsite?: unknown): Promise<LookupBrandResponse>;
```

Flow: `currentUserId()` (null → unauthenticated) → `apiKey = process.env.BRANDFETCH_API_KEY` (missing → unavailable) → domain: if `rawWebsite` is a non-empty string → `normalizeDomain` (null → invalid_domain); else read the email claim (`supabase.auth.getClaims()` → `claims.email`; add a tiny `currentUserEmail()` next to `currentUserId` in `web/lib/current-user.ts`) → its domain; free-mail or missing → `need_website` → `bumpBrandLookups(db, userId, today)` (`allowed: false` → daily_cap; note: a CACHE HIT should not count — check the cache first, then bump only before a real fetch) → `getCachedBrand` hit → respond `cached: true`; miss → `fetchBrand` → map failures 1:1 (`unauthorized` → `unavailable` + `reportError` so the owner sees a bad key in the logs) → `putCachedBrand` → `setAppliedBrand` is NOT called here (applying is a client decision; saving the default later carries `brandApplied`) → respond with `pickBrandColours` + `pickBrandFont`.

Tests (mocks for current-user, db, brandfetch, brand-cache, user-styles): unauthenticated; no key; free-mail email without website → need_website; website given → normalised domain used; cache hit skips fetch and the cap; miss → fetch called with the key; 404 → not_found; cap reached → daily_cap and no fetch; unauthorized → unavailable + reportError called.

Also extend `saveMyChartStyle(raw, brandApplied?)` to call `setAppliedBrand` when `brandApplied` is a valid `{ domain, name, fetchedAt }` (allow-list parsed) — test it.

Commit `feat(chart): lookupBrand server action — email-domain or website, cache, daily cap, key-gated (WP218 phase 3)`.

---

### Task 4: Panel "Merkkleuren" block + chart wiring

**Files:** modify `web/components/chart-config-panel.tsx` (+ test), `web/components/chart.tsx` (+ test).

Panel prop: `brand?: { lookup(website?: string): Promise<LookupBrandResponse> }` (present only when signed in — chart.tsx wires the server action, as with `account`). In the Kleuren tab, under the series rows: heading `Merkkleuren` (en `Brand colours`); a short line `Haal de kleuren en het lettertype van je organisatie op.` (en `Fetch your organisation's colours and font.`); button `Pas merkkleuren toe` (`Apply brand colours`), busy-disabled while pending; on `need_website` show an `Input` labelled `Website van je organisatie` (`Your organisation's website`) with placeholder `bijv. jouworganisatie.nl` — wait: that placeholder has no digits, fine — and the button retries with it; on success: `onChange({ seriesColors: <index → hex for each series i < colours.length whose judgeColor(hex).ok>, fontFamily: font?.family ?? undefined })` (omit `fontFamily` when null — do not clear an existing choice), `ensureFontLoaded` is handled by chart.tsx as usual, and a `role="status"` line `Kleuren en lettertype van {name} toegepast, via Brandfetch.` (`Colours and font of {name} applied, via Brandfetch.`), plus `Een lettertype dat niet vrij beschikbaar is, is overgeslagen.` when the font was custom/skipped; failure lines per reason: `unavailable` → `Merkkleuren ophalen is op dit moment niet mogelijk.`; `not_found` → `Voor dit domein is geen merk gevonden.`; `invalid_domain` → `Dat ziet er niet uit als een website.`; `rate_limited`/`daily_cap` → `Probeer het later nog eens.`; `error` → `Er ging iets mis. Probeer het later opnieuw.` All digit-free. The panel calls `onBrandApplied?.({ domain, name, fetchedAt })` so chart.tsx can hand it to `saveMyChartStyle` later (keep the last applied brand in ChartView state; pass it on save).

Tests (panel): no `brand` prop → no block; success path applies only accepted colours and the font, status line shown, `onChange` called once with the composed patch; `need_website` → input appears, second call carries the domain; failure copy per reason; digit scan still clean with the block open. Tests (chart.tsx): with a mocked `lookupBrand` resolving colours → the line stroke of series one becomes the first brand colour; the sink receives `brand_applied` (add `'brand_applied'` to `CHART_STYLE_EVENTS` in `src/chart/user-styles.ts` + the server-action enum — phase 6's counter grows by one event).

Commit `feat(chart): "Pas merkkleuren toe" in the Kleuren tab — applies brand colours + font through the R11 guard (WP218 phase 3, owner B)`.

---

### Task 5: Docs

- `docs/RUNBOOK.md`: secrets table row `BRANDFETCH_API_KEY` (Vercel env store, Production, Sensitive; how to get it: developers.brandfetch.com → register (no card) → Developer Dashboard → API key; rotation: new key in the dashboard → replace in Vercel → redeploy; **cost note:** 100 free lookups in total, then a paid plan (≈ $99/month for 2 500 — re-check the pricing page before paying); the cache means one call per organisation domain per 30 days and at most five lookups per user per day) + a "Supervised live step — WP218 phase 3 brand lookup (⏳ NOT YET RUN)" section: (1) migrations 028 + 029 applied, (2) key set, redeploy, (3) smoke: Kleuren → Pas merkkleuren toe with a real organisation domain → colours change, `select domain, fetched_at from brand_cache;` shows one row; second click → no new Brandfetch call (cached), (4) rollback: remove the key → the block says lookup is not available; the cache table may stay.
- `docs/decisions/039-chart-presentation-panel.md` addendum (phase 3 as built: cache + cap + guard), `docs/08-build-plan.md` § WP218 phase 3 ✅ (owner steps pending), `docs/open-questions.md` #218 (pricing fact + the 30-day cache assumption), `docs/05-data-rules.md` (brand_cache not personal; `user_chart_styles.brand` rides the user row), `docs/04-architecture.md` (chart row mentions the outside-service seam — the first third-party API besides Anthropic/CBS/Stripe/Resend).

Commit `docs(chart): WP218 phase 3 recorded — Brandfetch key + supervised step, cost note, ADR 039 addendum`.

## Self-review

Owner B: colours + fonts from the account's brand by email domain with a website box ✔ (T3/T4); "it needs to work" without the owner present is impossible for the live call (key) — the plan degrades honestly and documents the exact owner step ✔ (T5); R11 guard ✔ (T4); spend control ✔ (T2/T3); terms (30-day cache) ✔ (T2); no personal data leak ✔ (T2/T5). Names consistent across tasks: `normalizeDomain`, `isFreeMailDomain`, `parseBrandPayload`, `pickBrandColours`, `pickBrandFont`, `fetchBrand`, `getCachedBrand`, `putCachedBrand`, `bumpBrandLookups`, `setAppliedBrand`, `lookupBrand`, `currentUserEmail`.

# Brandfetch Brand API — research notes (2026-09-09)

Read-only research for calling the Brandfetch **Brand API** from a Node.js server to fetch
a company's brand colours and fonts by domain. Every fact below is cited; anything not
directly confirmed in an official source is marked **UNCONFIRMED**.

---

## 1. Endpoint + auth

- **Brand-by-domain endpoint (confirmed, official docs):**
  `GET https://api.brandfetch.io/v2/brands/domain/{domain}`
  A more general auto-detect route also exists: `GET https://api.brandfetch.io/v2/brands/{identifier}`
  where `{identifier}` can be a domain, email, Brand ID, ISIN, stock/ETF ticker, or crypto
  symbol — resolved in that order (domain → ticker → ISIN → crypto symbol).
  Source: https://docs.brandfetch.com/reference/brand-api , https://docs.brandfetch.com/brand-api/overview

- **Auth header:** `Authorization: Bearer <API_KEY>` — a server-side API key from the
  developer dashboard. Source: https://docs.brandfetch.com/brand-api/overview

- **Query parameter:** `allowNsfw` (boolean, optional) — controls NSFW content filtering.
  Source: https://docs.brandfetch.com/reference/brand-api

- **Separate client-id-based endpoint — yes, this is the Logo API, not the Brand API:**
  `https://cdn.brandfetch.io/{type}/{identifier}/{logoType}?c=BRANDFETCH_CLIENT_ID`
  (e.g. `https://cdn.brandfetch.io/domain/nike.com?c=YOUR_CLIENT_ID`). It is a CDN image
  link meant to be dropped straight into an `<img src="">` tag.
  **It returns logo images ONLY — no colours or fonts.** It requires a public client ID
  (not a secret bearer key) and needs no attribution.
  Sources: https://docs.brandfetch.com/logo-api/overview , https://brandfetch.com/developers/logo-api ,
  https://github.com/Brandfetch/Logo-API
  There is also a **Brand Search API** (name → domain/logo autocomplete) — also logo/name
  matching, not a colours/fonts source. Source: https://brandfetch.com/developers/brand-search-api
  → **Conclusion: to get colours and fonts you must use the Brand API (`api.brandfetch.io/v2/brands/...`)
  with a Bearer API key — the CDN/client-id route cannot give you colours or fonts.**

---

## 2. Response shape — colours and fonts

Official reference (https://docs.brandfetch.com/reference/brand-api) documents the field
names and enums below. I could not retrieve a full, verbatim example JSON payload from the
docs site in this session (the live reference page renders interactively; only the schema
was extracted) — the field-level shape is confirmed, but the **exact example JSON blob is
UNCONFIRMED verbatim** (reconstructed from schema + secondary-source snippets, not copy-pasted
from a page render).

**Colors array — field names confirmed:**
```json
{
  "hex": "#2557D6",
  "type": "brand",       // enum: "accent" | "dark" | "light" | "brand"
  "brightness": 84        // numeric, luminance-derived (0.2126*R + 0.7152*G + 0.0722*B)
}
```
Source: https://docs.brandfetch.com/reference/brand-api (schema), corroborated by
https://brandfetch.com/developers/brand-api ("Brand colors with roles (accent, dark, light,
brand) and brightness").
Note: one secondary source (Medium writeup, not official) showed `brightness` as an integer
example (161) rather than the 0–1 float the reference schema implies — **the exact numeric
range/type of `brightness` is UNCONFIRMED** (could be 0–1 float or 0–255-ish int; treat
defensively in code, e.g. don't assume a fixed range).

**Fonts array — field names confirmed:**
```json
{
  "name": "Inter",
  "type": "title",         // enum: "title" | "body"
  "origin": "google",      // enum: "google" | "custom" | "system"
  "originId": "Inter",     // nullable string
  "weights": []             // array (exact item shape UNCONFIRMED)
}
```
Source: https://docs.brandfetch.com/reference/brand-api (schema)

**Other top-level fields confirmed present on the brand object:** `id`, `name`, `domain`,
`claimed`, `description`, `longDescription`, `logos` (array, each with `theme`, `formats`,
`tags`, `type`), `qualityScore` (0–1), `isNsfw`, `urn`, and firmographic fields (`company`
object with `employees`, `financialIdentifiers`, `foundedYear`, `industries`, `kind`,
`location`). Source: https://docs.brandfetch.com/reference/brand-api

---

## 3. Error behaviour

- **Unknown/invalid domain:** `404` ("Not Found" / "Invalid Domain Name").
  Source: https://docs.brandfetch.com/reference/brand-api
- **Malformed input (e.g. malformed email identifier):** `400`, and per the docs this is
  *not billed against quota*. Source: https://docs.brandfetch.com/reference/brand-api
- **Bad/missing API key:** `401`. Source: https://docs.brandfetch.com/reference/brand-api
- **Rate limiting / quota exceeded:** `429` ("API key quota exceeded").
  Source: https://docs.brandfetch.com/reference/brand-api , https://docs.brandfetch.com/llms-full.txt (via fetch)
- **Documented throughput ceiling (separate from monthly quota):** "sustained 100
  requests/second, with some flexibility to accommodate bursts (30,000 requests / rolling
  5-minute hard limit)." No separate per-minute figure is documented.
  Source: https://docs.brandfetch.com/llms-full.txt (via fetch — could not re-verify by
  direct fetch of that exact URL a second time; treat the specific numbers as **UNCONFIRMED
  pending a second read of the primary doc**, though they were returned consistently by the
  fetch tool citing the official docs domain).
- **HEAD requests** (used for prefetching whether a brand exists) do not count against
  quota on paid plans; **prefetch via HEAD returns `403` on the free tier**.
  Source: https://docs.brandfetch.com/llms-full.txt (via fetch)

---

## 4. Pricing and quotas (page read 2026-09-09)

- **Free tier:** 100 free requests total after signup, no credit card required. Docs
  wording ("you get 100 free requests") does not explicitly say "one-time" vs "per month
  forever" in the sentence itself; the pricing page (brandfetch.com/developers/pricing)
  labels it a "(one-time allocation)" of 100 brand fetches, 1 credit per fetch.
  → **Take-away: treat the free Brand API allowance as 100 requests total, not 100/month** —
  this is the pricing page's own framing, though the overview page's phrasing alone is
  ambiguous, so flag as **largely confirmed, minor wording ambiguity**.
  Sources: https://docs.brandfetch.com/brand-api/overview , https://brandfetch.com/developers/pricing
  (Note: a third-party comparison blog claimed "250 free requests/month" — this contradicts
  the two official Brandfetch pages above and is treated as **wrong/UNCONFIRMED**, not used.)
- **First paid tier ("Growth"):** $99/month, ~2,500 brand fetches/month, overage $0.10 per
  fetch beyond quota, ~23% discount for annual billing. Credit pool resets monthly, no
  rollover; usage alerts at 80% and 100%.
  Source: https://brandfetch.com/developers/pricing
  (A separate secondary source quoted "$129/month for 2,500 fetches, shared across Brand
  API + Brand Context API" — this looks like it may describe a different/newer bundled
  "Standard" plan structure than the "Growth" plan on the pricing page fetched directly;
  **the $99 vs $129 discrepancy is UNCONFIRMED / not reconciled** — verify directly on
  https://brandfetch.com/developers/pricing before quoting a number to a client.)
- **Attribution requirement on the free Brand API plan:** **not found** in either the
  overview or pricing pages — no "powered by Brandfetch" / backlink clause is stated for
  the Brand API free tier. (Attribution is explicitly *not* required for the separate Logo
  API and Brand Search API — "we don't ask for any attribution" — but that's a different
  product.) → **No attribution requirement confirmed for Brand API's free tier**, but this
  is an absence-of-evidence finding, not a page that explicitly says "no attribution
  needed" for this specific product — flag as **UNCONFIRMED (no explicit statement either
  way for the Brand API specifically)**.
  Sources: https://docs.brandfetch.com/brand-api/overview , https://brandfetch.com/developers/pricing ,
  https://brandfetch.com/developers/logo-api

---

## 5. Terms — caching/storing colours and fonts server-side

**Confirmed, from the official Terms and Conditions (https://brandfetch.com/terms), section
on IP/License:**

> "limited, non-exclusive, non-transferable, revocable license to download, store, and
> cache the Content ... retrieved via API calls for a maximum period of thirty (30) days
> from the date of retrieval"

> "The Customer is required to make a new API call at least once every thirty (30) days to
> refresh the Cached Content and to automatically renew the hereby granted license."

Failing to refresh within 30 days is described as a material breach that can let Brandfetch
suspend service or require deletion of improperly-retained data.

**Practical implication for this project:** it is allowed to store/cache the fetched colours
and fonts in our own database, but the code must re-fetch (and refresh the stored copy) at
least once every 30 days per domain to stay compliant — a stored brand-colour/font row older
than 30 days without a re-fetch is a terms violation, not just a staleness concern.

Separately noted (different API, for contrast): the Brand Search API's terms say brand
*names* from that API "should not be cached" and logo URLs from it "must be hotlinked" —
that stricter no-cache rule is specific to Brand Search API, not the Brand API's colours/fonts.
Source: https://brandfetch.com/terms (via fetch), corroborated in web search snippets citing the same terms page.

Enterprise customers can negotiate custom caching terms via a written agreement — irrelevant
unless we're on that tier. Source: https://brandfetch.com/terms

---

## 6. Getting an API key (owner-followable, 3 steps)

1. Go to https://developers.brandfetch.com/register and create a free developer account
   (no credit card required).
2. Once signed in, open the Developer Dashboard — your Brand API key is listed there
   (a Bearer-token secret; keep it server-side, never in frontend code).
3. Use that key in your Node.js server as `Authorization: Bearer <key>` when calling
   `https://api.brandfetch.io/v2/brands/domain/{domain}`.

Source: https://docs.brandfetch.com/brand-api/overview , https://docs.brandfetch.com/llms-full.txt (via fetch)

---

## Sources

- https://docs.brandfetch.com/brand-api/overview
- https://docs.brandfetch.com/reference/brand-api
- https://docs.brandfetch.com/logo-api/overview
- https://docs.brandfetch.com/llms-full.txt (fetched successfully in one call; a later
  direct re-fetch of this exact URL 404'd in this session — treat repeated numbers from it
  as sourced-once, not independently re-verified)
- https://brandfetch.com/developers/brand-api
- https://brandfetch.com/developers/pricing
- https://brandfetch.com/developers/logo-api
- https://brandfetch.com/developers/brand-search-api
- https://brandfetch.com/terms
- https://github.com/Brandfetch/Logo-API (secondary, corroborating)

## Open discrepancies / UNCONFIRMED items (do not treat as settled without a direct re-check)

- Free tier "100 requests" — one-time allocation vs. recurring: pricing page says
  one-time; overview page's own sentence is ambiguous. A third-party blog's "250/month"
  claim is rejected as contradicting both official pages.
- First paid tier price: $99/month (Growth, 2,500 fetches, official pricing page) vs. a
  secondary source's "$129/month, 2,500 fetches, shared Brand API + Brand Context API
  quota" (possibly a newer/renamed "Standard" plan) — reconcile against the live pricing
  page before quoting to the owner.
- `brightness` field's numeric type/range (float 0–1 per the luminance formula vs. an
  integer example seen in a secondary source).
- Exact shape of the `weights` array under fonts — not found in any fetched source.
- The literal full example JSON for a real domain (e.g. nike.com) via `/v2/brands/domain/`
  — schema fields are confirmed individually, but no single verbatim example payload was
  retrieved in this session.
- The 100 req/s + 30,000-req/5-min throughput figures — sourced from one fetch of
  llms-full.txt; a follow-up direct fetch of that URL failed (404), so these numbers
  weren't independently re-confirmed a second time in this session.

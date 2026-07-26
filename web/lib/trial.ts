// Server-side helpers for the #53 anonymous trial (ADR 036). Pure
// server-module (node:crypto, next/headers) — never imported by client code.
//
// Dormancy contract (D3): the trial EXISTS only when TRIAL_ENABLED='1' AND
// the separate trial API key AND the ip-hash secret are set. Anything less →
// 'dormant', and the landing renders byte-identically to a build without
// this feature (the WP129/WP135 pattern). Enabled but not servable → the
// visible degrade to "log in om verder te gaan" the owner decided, never a
// broken page — and since 2026-07-25 that degrade is TWO states, because they
// are two different truths: 'closed' when the pot was read and is at 0 (the
// copy may say so), 'unavailable' when the pot table is missing or the read
// threw (the copy must not name a cause we do not have).
import { createHmac } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import {
  getTrialPotStatus,
  TRIAL_QUESTIONS_PER_IP_PER_DAY,
  TRIAL_QUESTIONS_PER_VISITOR,
} from '../backend/billing/index.ts';
import type { TrialPotStatus } from '../backend/billing/index.ts';
import { getDb } from './db.ts';
import { ANONYMOUS_READ_DEADLINE_MS, withDeadline } from './deadline.ts';

/** The D1 visitor cookie: HttpOnly, functional-only, set on FIRST use. */
export const TRIAL_COOKIE = 'cdc_trial';
export const TRIAL_COOKIE_MAX_AGE_S = 180 * 24 * 60 * 60;

/** One dotted-quad pattern, built into both regexes below that need it — it
 * was written out twice, so a future tightening could reach only one. */
const IPV4 = String.raw`\d{1,3}(?:\.\d{1,3}){3}`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonically-shaped UUID. Exported because the trial's
 * `requestId` needs the SAME shape check as the visitor cookie and for a
 * sharper reason: `trial_questions.request_id` is `text` (migration 020) while
 * `audit_answers.request_id` is `uuid` (migration 010), so a non-UUID id is
 * accepted by the pot take and only rejected by the R8 insert — AFTER both LLM
 * calls have been paid for. See the guard in trial-actions.ts. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function trialConfigured(): boolean {
  return (
    process.env.TRIAL_ENABLED === '1' &&
    typeof process.env.ANTHROPIC_TRIAL_API_KEY === 'string' &&
    process.env.ANTHROPIC_TRIAL_API_KEY.length > 0 &&
    typeof process.env.TRIAL_IP_HASH_SECRET === 'string' &&
    process.env.TRIAL_IP_HASH_SECRET.length > 0
  );
}

/** The visitor's cookie id, ONLY if it parses as a UUID — a forged/garbage
 * cookie value counts as no cookie (never reaches SQL as-is). */
export async function readTrialVisitorId(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(TRIAL_COOKIE)?.value;
  return value !== undefined && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

/** The BUCKET KEY an address hashes under — exported so the /64 rule is tested
 * directly rather than only through the HMAC, where every wrong answer looks
 * like the same opaque hex.
 *
 * #182: for IPv6 we key on the /64 PREFIX, not the full address. A
 * residential IPv6 customer is delegated a /64 at minimum and often a /56, so
 * hashing the whole address gives ONE visitor 2^64 distinct buckets and the
 * per-IP backstop bounds nothing at all. The /64 is the household, which is the
 * unit the limit is actually about. IPv4 is returned unchanged — one address is
 * already the household there.
 *
 * Measured NOT reachable when written (2026-07-25): `dig AAAA` was empty for
 * both checkdecijfers.vercel.app and checkdecijfers.nl, so every address
 * arriving today is IPv4 and this path changes nothing. It becomes load-bearing
 * the day the apex goes through an IPv6-capable front, which the launch plan
 * contemplates — which is exactly why it ships before that and not after.
 *
 * The returned string is a stable KEY, not a valid address: callers only need
 * two requests from one /64 to agree, and two from different /64s to differ. */
export function ipBucketKey(raw: string): string {
  let ip = raw.trim();
  // `[2001:db8::1]:443` — bracketed form, optionally with a port.
  if (ip.startsWith('[')) {
    const close = ip.indexOf(']');
    if (close > 0) ip = ip.slice(1, close);
  }
  // Zone index (`fe80::1%eth0`); never seen in x-forwarded-for, cheap to drop.
  const zone = ip.indexOf('%');
  if (zone > 0) ip = ip.slice(0, zone);
  // An IPv4 with a port contains ':', so without this it would fall into the
  // IPv6 branch and earn a fresh bucket per ephemeral port.
  const v4WithPort = new RegExp(`^(${IPV4})::?\\d+$`).exec(ip);
  if (v4WithPort) return v4WithPort[1]!;
  if (!ip.includes(':')) return ip; // IPv4, or the 'unknown' sentinel.

  // ONE canonical form, then one decision — rather than a branch per textual
  // spelling. Three review findings were three spellings of the SAME case
  // (`::ffff:1.2.3.4`, `::ffff:c000:0207`, `::1.2.3.4`), each previously
  // patched separately while the next spelling stayed broken and collapsed
  // into a shared `0:0:0:0::/64` bucket with `::1` and `::`.
  //
  // Step 1: split off a trailing dotted quad so every embedded-IPv4 form
  // reduces to the same 8-hextet shape.
  let tail4: string | null = null;
  const embedded = new RegExp(`^(.*:)(${IPV4})$`).exec(ip);
  if (embedded) {
    ip = embedded[1]!;
    tail4 = embedded[2]!;
  }

  // Step 2: expand `::` BEFORE slicing — `2001:db8::1` split naively on ':'
  // yields ['2001','db8','','1'], whose first four groups are NOT the /64.
  let groups: string[];
  if (ip.includes('::')) {
    const [head = '', rest = ''] = ip.split('::');
    const headParts = head.split(':').filter((p) => p !== '');
    const tailParts = rest.split(':').filter((p) => p !== '');
    const present = headParts.length + tailParts.length + (tail4 === null ? 0 : 2);
    const zeros = Math.max(0, 8 - present);
    groups = [...headParts, ...Array<string>(zeros).fill('0'), ...tailParts];
  } else {
    groups = ip.split(':').filter((p) => p !== '');
  }
  if (tail4 !== null) {
    const o = tail4.split('.').map((n) => Number(n) & 255);
    groups.push((((o[0]! << 8) | o[1]!) >>> 0).toString(16), (((o[2]! << 8) | o[3]!) >>> 0).toString(16));
  }

  const norm = groups.map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''));
  // Anything that is not 8 valid hextets is malformed. Return it verbatim
  // rather than guessing: a wrong GUESS merges unrelated visitors into one
  // 5/day bucket, while a verbatim key is unique per input and can only ever
  // be over-permissive to the one sender that produced it. It cannot collide
  // with a /64 key (those end `::/64`) or an IPv4 key (those have no colon).
  if (norm.length !== 8 || !norm.every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
    return `unparsed:${ip}${tail4 === null ? '' : tail4}`;
  }

  // Step 3: an embedded IPv4 — mapped (`::ffff:a.b.c.d`) or the deprecated
  // compatible form (`::a.b.c.d`) — IS an IPv4 client; bucket it as one, or
  // the same visitor lands in two buckets depending on which spelling the
  // platform handed us. `::1` and `::` fall out here as 0.0.0.1 and 0.0.0.0 —
  // distinct, deterministic, and no longer sharing a bucket with each other.
  const highIsZero = norm.slice(0, 5).every((g) => g === '0');
  if (highIsZero && (norm[5] === 'ffff' || norm[5] === '0')) {
    const hi = Number.parseInt(norm[6]!, 16);
    const lo = Number.parseInt(norm[7]!, 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return `${norm.slice(0, 4).join(':')}::/64`;
}

/** HMAC-hashed request IP (ADR 036 D2): raw IPs never persist.
 *
 * **Header order (#187, settled against vercel.com/docs/headers/request-headers
 * on 2026-07-26 by reading the page, not an index).** Two things it says, both
 * quoted exactly:
 *
 *   - on `x-forwarded-for`: *"If you are trying to use Vercel behind a proxy, we
 *     currently overwrite the `X-Forwarded-For` header and do not forward
 *     external IPs. This restriction is in place to prevent IP spoofing."*
 *     (Overriding it is an Enterprise "trusted proxy" purchase; we are on Hobby,
 *     so a client-supplied value never reaches us — the header is NOT forgeable
 *     here, which is what #187 asked.)
 *   - on `x-vercel-forwarded-for`: *"This header is identical to the
 *     `x-forwarded-for` header. However, `x-forwarded-for` could be overwritten
 *     if you're using a proxy on top of Vercel."*
 *
 * So we read `x-vercel-forwarded-for` FIRST. Today that is a no-op — the two are
 * identical. It matters at the launch trigger: put Cloudflare in front (the
 * plan) and `x-forwarded-for` carries the PROXY's address, which would collapse
 * every visitor into a handful of edge buckets and lock real people out of a
 * 5/day limit they never used. The platform header keeps the real client. An
 * earlier draft of this comment dismissed `x-vercel-forwarded-for` as
 * undocumented; that was wrong, and it is documented as the fix for precisely
 * the scenario this product is heading into.
 *
 * `||`, not `??`, on the fall-through (2026-07-25): a header that is PRESENT
 * but EMPTY splits to `''`, which is not nullish — so `??` short-circuited on
 * it and never consulted `x-real-ip`, hashing a third shared bucket distinct
 * from both a real address and `'unknown'`. Not reachable on Vercel, which
 * overwrites `x-forwarded-for` itself; it would become reachable the moment
 * this sits behind any other proxy, which the launch plan contemplates.
 *
 * The secret is ASSERTED, not defaulted. It used to fall back to `''`, and an
 * unkeyed SHA-256 of an IPv4 address is reversible by brute force over the
 * whole 2^32 space — i.e. the silent failure of `??` here would have been the
 * precise defeat of the "raw IPs never persist" guarantee D2 makes, plus a
 * silent second budget for every visitor (keyed and unkeyed hashes differ).
 * Today `trialConfigured()` guarantees it is set on every path that reaches
 * here; this makes that guarantee loud instead of load-bearing-but-unstated. */
export async function hashedRequestIp(): Promise<string> {
  const secret = process.env.TRIAL_IP_HASH_SECRET;
  if (secret === undefined || secret.length === 0) {
    throw new Error('TRIAL_IP_HASH_SECRET is unset — refusing to persist an unkeyed IP hash');
  }
  const h = await headers();
  // Normalise EACH tier before choosing, rather than chaining raw header values.
  // Two review findings landed here in sequence: `??` let a present-but-empty
  // header mask a populated one, and `||` on raw values still let a
  // WHITESPACE-only header win and then trim away to nothing. Taking the first
  // entry and trimming inside the helper makes empty, blank and absent behave
  // identically at every tier — which is the property the fallback needs.
  const firstEntry = (value: string | null): string => value?.split(',')[0]?.trim() ?? '';
  const ip =
    firstEntry(h.get('x-vercel-forwarded-for')) ||
    firstEntry(h.get('x-forwarded-for')) ||
    firstEntry(h.get('x-real-ip')) ||
    'unknown';
  // #182: hash the BUCKET, not the address — over IPv6 those differ by 2^64.
  return createHmac('sha256', secret).update(ipBucketKey(ip)).digest('hex');
}

export type TrialGateState =
  | { kind: 'dormant' }
  /** The pot was READ and is empty. Only this state may say so to the visitor.
   *
   * Since #186 that reading may be up to `TRIAL_POT_TTL_MS` old, so the copy's
   * "op dit moment leeg" means "when we last looked, at most 20 seconds ago".
   * That is a different class of claim from the 2026-07-25 sin this state was
   * split out to fix: an OBSERVED fact of bounded age, not an unverified cause.
   * Principle (c) forbids the second, not the first. */
  | { kind: 'closed' }
  /** We could not determine the pot state (table absent, DB unreachable, pooler
   * full). Degrades identically to 'closed' — but the copy must NOT name a
   * cause, because we do not know one. Split out from 'closed' on 2026-07-25:
   * the single state made the landing tell every visitor "het gratis proefpotje
   * is op dit moment leeg" during a #173 pooler exhaustion, when the pot may
   * well have been full. No number is wrong, so no invariant is breached — but
   * asserting an unverified cause to the public is the exact habit this product
   * exists to not have (principle (c)). */
  | { kind: 'unavailable' }
  /** THIS visitor's own budget is spent (the pot may still be open). */
  | { kind: 'used_up' }
  /** This NETWORK's 24h backstop is spent (#184). The visitor may personally
   * have asked nothing — behind CGNAT or an office NAT that is the normal case,
   * which is why the copy attributes it to the network and not to them. Before
   * #184 this state existed only on the ACTION's response, so a capped visitor
   * was invited to type a question and told one round-trip later. */
  | { kind: 'ip_limit' }
  | { kind: 'open'; questionsLeft: number };

/** How long the landing may serve a pot reading it has already made (#186).
 *
 * MEASURED 2026-07-25, which is why this exists. `pg_stat_statements` (never
 * reset since 2026-07-02) shows `select remaining_questions, cap from
 * trial_pot_config` at **143 calls since the trial went live on 2026-07-17** —
 * ~17/day, one per anonymous homepage render — against 5 per-visitor counts and
 * 2 questions actually served. The cost is not the 0.44 ms query. It is the
 * POOLER SESSION the query forces the instance to open: sampled the same night,
 * a single anonymous GET left a Supavisor backend **idle for 174 s and
 * counting**, because node-pg's 10 s idle timeout does not fire while a Fluid
 * Compute instance is frozen. One drive-by can therefore hold one of the free
 * tier's 15 session slots for minutes ([#173](docs/open-questions.md)).
 *
 * What this buys, stated against the state that actually ships (#186 + #184)
 * and stated precisely, because "one query" is a claim: **a steady-state
 * anonymous render costs ONE query, cookie or no cookie, down from 1-2.** The
 * render that actually refreshes the pot costs two — but that is at most one
 * render per TTL per instance, not one per visitor. The two limit counts fold
 * into a single round trip either way. #186 alone would
 * have made a cookie-less drive-by cost ZERO queries; #184 spends that back to
 * buy the honesty fix, deliberately and with the trade recorded in both rows.
 * The named next lever, if traffic ever makes it worth the machinery, is a
 * bounded per-`ip_hash` cache for that remaining count.
 *
 * 20 s, not longer: the owner's "a pot refill re-opens the trial WITHOUT a
 * deploy" decision then survives to within the TTL, and an operator who runs
 * `npm run trialpot:set` and reloads to check gets the truth by waiting out one
 * TTL — a delay short enough to sit through, which 30 s+ is not.
 * Not shorter: below ~15 s the drive-by storm and deploy-burst cases — the only
 * ones this helps — stop being covered. */
export const TRIAL_POT_TTL_MS = 20_000;

let potCache: { at: number; value: Readonly<TrialPotStatus> } | null = null;
// In-flight coalescing, the ontdek.ts / llms-txt.ts pattern: without it a
// deploy burst landing N concurrent requests on one cold instance triggers N
// reads — precisely the #173 shape this exists to prevent. The shared promise
// NEVER rejects (see probePot), so one caller's failure cannot fan out to the
// others as an unhandled rejection.
let potInflight: Promise<TrialPotStatus | null> | null = null;

/** Test seam: reset the module-scope cache between cases (the resetOntdekCache
 * / resetLlmsTxtCache idiom — call it from the suite's `beforeEach`). */
export function resetTrialPotCache(): void {
  potCache = null;
  potInflight = null;
}

/** Resolves; NEVER rejects — load-bearing, not merely tidy. Every concurrent
 * caller on the instance shares this one promise, and `readPotCached` attaches
 * a bare `.finally()` to it; if this ever rethrew, that would become an
 * unhandled rejection AND fan the failure out to every waiter at once. */
async function probePot(): Promise<TrialPotStatus | null> {
  try {
    const pot = await getTrialPotStatus(getDb());
    // Only a SUCCESSFUL read is cached. A null is "we do not know", and
    // remembering that for 20 s would keep telling visitors the trial is
    // unavailable after the database has recovered — the expensive direction,
    // since a stale 'open' costs nothing (the atomic take is the real gate)
    // while a stale 'unavailable' costs a visitor the whole trial.
    if (pot !== null) potCache = { at: Date.now(), value: Object.freeze({ ...pot }) };
    return pot;
  } catch (err) {
    // getDb() can throw synchronously (no DATABASE_URL) and a stubbed
    // getTrialPotStatus can reject; the real one already catches its own query
    // failures. All three must land as null rather than as a rejection of the
    // promise every concurrent caller on this instance is sharing.
    console.warn('[trial] pot read failed — reporting unknown, not empty:', err);
    return null;
  }
}

/** The pot reading the landing gate uses, cached for `TRIAL_POT_TTL_MS`.
 *
 * Deliberately NOT ontdek.ts's stale-over-nothing. That module serves an
 * EXPIRED cache when a rebuild fails, which is right for charts and wrong here:
 * an expired "open" from before an outage would invite a visitor to type a
 * question into a backend we have just observed to be down. So an expired entry
 * is never resurrected — a failed refresh falls through to null, which the gate
 * renders as 'unavailable' (we could not tell), never as 'closed' (we looked,
 * and it was empty).
 *
 * Only the POT is cached. The per-visitor count below stays live on every
 * request: it is per-visitor data, and sharing it across requests on a reused
 * instance would hand one visitor another's budget. */
async function readPotCached(): Promise<TrialPotStatus | null> {
  const hit = potCache;
  if (hit !== null && Date.now() - hit.at < TRIAL_POT_TTL_MS) return hit.value;
  if (potInflight === null) {
    const probe = probePot();
    potInflight = probe;
    // Cleared HERE and not in probePot's own `finally`: a probe that settles
    // without ever suspending would run that finally BEFORE this assignment and
    // latch the resolved promise forever (getDb() throwing synchronously is
    // exactly that path). The identity check stops a slow probe clearing a
    // newer one.
    void probe.finally(() => {
      if (potInflight === probe) potInflight = null;
    });
  }
  return potInflight;
}

/** The landing's gate read (server component). The pot reading is at most
 * `TRIAL_POT_TTL_MS` old (#186); everything derived from the VISITOR or their
 * NETWORK is computed fresh on every request. A pot refill still re-opens the
 * trial WITHOUT a deploy (owner decision: auto re-enable) — now to within the TTL.
 * Fail-safe unchanged: anything short of a verified open pot degrades to the
 * login nudge, never to a broken page — only the REASON we show is
 * distinguished from the reason we merely assumed. */
export async function getTrialGateState(): Promise<TrialGateState> {
  // Dormancy stays SYNCHRONOUS and outside the deadline: while the flags are
  // unset there is no read to bound and no timer to arm (byte-identical landing).
  if (!trialConfigured()) return { kind: 'dormant' };
  // #190(b): a saturated pool made this WAIT rather than degrade — the fail-safe
  // engaged on errors and never on waits, so the visitor got a page that never
  // finished instead of the login nudge that was designed for exactly this.
  // 'unavailable' is the right fallback and not 'closed': a read we abandoned is
  // not evidence the pot is empty, which is the same distinction the two states
  // were split apart for on 2026-07-25.
  return withDeadline(computeTrialGateState(), { kind: 'unavailable' }, 'trial', ANONYMOUS_READ_DEADLINE_MS);
}

async function computeTrialGateState(): Promise<TrialGateState> {
  try {
    const pot = await readPotCached();
    // getTrialPotStatus returns null for BOTH "table absent" and "read threw"
    // — neither is evidence the pot is empty.
    if (pot === null) return { kind: 'unavailable' };
    if (pot.remaining <= 0) return { kind: 'closed' };
    // Both limits in ONE round trip (#184). Two scalar subqueries rather than
    // one FROM with an OR: each is textually the query it replaces (the old gate
    // count, and takeTrialQuestion's own ip count), so no equivalence proof is
    // needed at the next edit — and each hits its own PARTIAL index from
    // migration 020 (`… where not refunded`). An OR-form whose outer WHERE
    // omitted `not refunded` would imply neither index predicate and degrade to
    // a seq scan per anonymous page view, which is the pressure #186 is about.
    //
    // Net effect with #186's cache: a STEADY-STATE anonymous render costs ONE
    // query, cookie or no cookie — down from 1-2 — while gaining the honesty
    // fix. The render that refreshes the pot costs two, at most once per TTL per
    // instance. The #184 row's "adds a third uncached query" objection is
    // discharged, not accepted.
    const visitorId = await readTrialVisitorId();
    const ipHash = await hashedRequestIp();
    const db = getDb();
    const { rows } = await db.query(
      `select
         (select count(*)::int from trial_questions
           where visitor_id = $1::uuid and not refunded) as visitor_n,
         (select count(*)::int from trial_questions
           where ip_hash = $2::text and not refunded
             and created_at > now() - interval '24 hours') as ip_n`,
      [visitorId, ipHash],
    );
    // visitorId is null until the visitor's FIRST use, and `visitor_id = null`
    // is NULL, not false — so visitor_n is 0 and the budget reads full, exactly
    // as the old early return did. The IP arm still runs, and that is the whole
    // point: the visitor #184 is about is usually a FIRST-time visitor behind a
    // network someone else already spent.
    const visitorUsed = Number(rows[0]!.visitor_n);
    const networkUsed = Number(rows[0]!.ip_n);
    const left = TRIAL_QUESTIONS_PER_VISITOR - visitorUsed;
    // Visitor before network, mirroring takeTrialQuestion's own order, so that
    // where both apply the gate names the same cause the action would.
    if (left <= 0) return { kind: 'used_up' };
    // ⚠ The one direction in which this gate can be STRICTER than the take, so
    // it is written down rather than discovered later. `used_up` is keyed on the
    // visitor COOKIE, which is stable between render and submit; `ip_limit` is
    // keyed on the address of the RENDER request, and a large NAT or CGNAT
    // gateway may hand a later request a different address from its pool. So a
    // visitor can be shown this nudge — and lose the form, since trial.tsx
    // renders the nudge INSTEAD of the chat — where the submit would have
    // carried an uncapped address and takeTrialQuestion would have let them
    // through. Accepted, for three reasons: the sentence is true of what we
    // actually read, it is self-healing (a reload re-reads the address), and the
    // alternative is the status quo this row exists to fix, where every capped
    // visitor types a question first and is refused afterwards. Trading a rare
    // over-refusal for a common wasted effort is the right way round — but it IS
    // a trade, not a free win.
    if (networkUsed >= TRIAL_QUESTIONS_PER_IP_PER_DAY) return { kind: 'ip_limit' };
    // NOT clamped by the network's headroom: showing "1 van 2 over" because a
    // stranger on the same NAT spent one would tell this visitor they had used a
    // question they never asked. The budget shown is theirs; ip_limit covers the
    // exhausted case.
    return { kind: 'open', questionsLeft: left };
  } catch (err) {
    console.warn('[trial] gate read failed, rendering unavailable:', err);
    return { kind: 'unavailable' };
  }
}

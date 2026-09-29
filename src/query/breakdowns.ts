// Breadth step 3, Task 2 — breakdown resolver: picks CBS's own grand total for
// an unnamed breakdown dimension by a MEASURED conservative rule, or refuses
// with a button question. Pure module: no db, no ingestion import, no LLM call
// (principle a/c) — it takes its own plain input type (BreakdownDimension,
// distinct from src/cbs-adapter's CbsDimension/CbsCode) so this file has zero
// coupling to the adapter layer beyond field shape.
//
// The total rule below (docs/superpowers/plans/2026-09-28-breadth-step-3-breakdown-resolver.md,
// Global Constraints — measured 2026-09-28 over ALL 2,330 breakdown
// dimensions of the 1,271 current CBS tables) is intentionally
// conservative: every trap it must keep refusing is a REAL CBS dimension
// where a naive "first member wins" or "title contains totaal" heuristic
// would have silently picked a sub-total or an unrelated statistic — see the
// fixture cases in tests/query/breakdowns.test.ts, each traced to a real
// table/dimension pair. Do NOT loosen this rule without re-measuring.
//
// Tightened session 139 (final-review fix wave, F1) after the review found
// 85004NED/BronEnTechniek: first member 'Zonnestroom, totaal' (E006590) is a
// candidate ONLY via the '; totaal'/', totaal' suffix — a solar sub-total in
// a solar+wind table, not the dimension's grand total. The first member must
// now ALSO qualify on its own (a 'Totaal'-prefixed title or a T00 code) —
// this is STRICTER than before, never a loosening of the measured rule.
export interface BreakdownMember {
  code: string;
  title: string;
}

export interface BreakdownDimension {
  name: string;
  title: string;
  kind: 'TimeDimension' | 'GeoDimension' | 'Dimension' | string;
  members: BreakdownMember[];
}

export type DimensionClass = 'time' | 'geo' | 'geo_like' | 'margins' | 'breakdown';

/** A member whose code starts with 'T00' — CBS's own convention for a total
 * row.
 * **Assumption:** CBS codes are uppercase in practice — measured 2026-09-28:
 * 0 of all member codes in the 1,271-table crawl start with lowercase 't00'.
 * Mirrored in docs/open-questions.md (#337). Revisit if a CBS table ever uses
 * a lowercase code. */
function hasTotalCode(m: BreakdownMember): boolean {
  return m.code.startsWith('T00');
}

/** A member whose title starts with 'Totaal' (case-insensitive, leading
 * whitespace allowed). This, together with `hasTotalCode`, is what makes a
 * member eligible to itself BE the dimension's first-member total (F1,
 * session 139) — a member that is only a candidate via the '; totaal' /
 * ', totaal' suffix (see `isTotalCandidate`) never qualifies here. */
function hasTotalTitle(m: BreakdownMember): boolean {
  return /^\s*totaal/i.test(m.title);
}

/** A member is a *total-like candidate* when its title starts with 'Totaal'
 * (case-insensitive, leading space allowed), OR its code starts with 'T00',
 * OR its title ends with '; totaal' / ', totaal' (case-insensitive). This is
 * the FULL candidate test from the plan's Global Constraints — used both to
 * find the grand total below and, deliberately, nowhere else (a candidate is
 * not by itself "the total"; see findGrandTotal). */
function isTotalCandidate(m: BreakdownMember): boolean {
  if (hasTotalTitle(m)) return true;
  if (hasTotalCode(m)) return true;
  if (/[;,]\s*totaal\s*$/i.test(m.title)) return true;
  return false;
}

/**
 * CBS's own grand total for a breakdown dimension, or null when the rule
 * cannot conservatively pick one (the caller must then ask, per principle c).
 *
 * The dimension's grand total is the FIRST member, and only when:
 *   (0) the first member itself qualifies by a 'Totaal'-prefixed title OR a
 *       T00 code (session 139, F1) — a first member that is a candidate
 *       ONLY via the '; totaal' / ', totaal' suffix never qualifies (real
 *       trap: 85004NED/BronEnTechniek's 'Zonnestroom, totaal', a solar
 *       sub-total in a solar+wind table). The suffix still makes OTHER
 *       members candidates, so it still breaks uniqueness below. AND
 *   (a) the first member is a total-like candidate (the fuller test,
 *       including the suffix), AND
 *   (b) it is the ONLY candidate in the whole member list, OR it is the ONLY
 *       member (in the whole list) whose code starts with 'T00'.
 * Anything else -> null (no total, ask).
 */
export function findGrandTotal(members: BreakdownMember[]): BreakdownMember | null {
  if (members.length === 0) return null;
  const first = members[0];
  if (!hasTotalTitle(first) && !hasTotalCode(first)) return null; // (0) first must qualify on its own
  // (0) already implies isTotalCandidate(first) — hasTotalTitle/hasTotalCode
  // are both part of that fuller test — so no separate (a) check is needed.

  const candidates = members.filter(isTotalCandidate);
  if (candidates.length === 1) return first; // first is the only candidate

  const t00Members = members.filter(hasTotalCode);
  if (t00Members.length === 1 && t00Members[0] === first) return first; // first is the only T00 code

  return null;
}

/** The margins convention's designated member: titled exactly 'Waarde'
 * (trimmed, case-insensitive) — never a margin (Ondergrens/Bovengrens) member,
 * never guessed when absent. */
export function marginsValueMember(members: BreakdownMember[]): BreakdownMember | null {
  return members.find((m) => m.title.trim().toLowerCase() === 'waarde') ?? null;
}

/** Region-like dimension codes: CBS's own region-family prefixes, each
 * followed by at least one digit (docs/superpowers/plans/2026-09-28-breadth-step-3-breakdown-resolver.md
 * Global Constraints). */
const GEO_LIKE_CODE_PATTERN = /^(NL|PV|GM|LD|CR|WK|BU)\d/;
const GEO_LIKE_THRESHOLD = 0.8;

function isGeoLikeDimension(members: BreakdownMember[]): boolean {
  if (members.length === 0) return false;
  const matching = members.filter((m) => GEO_LIKE_CODE_PATTERN.test(m.code)).length;
  return matching / members.length >= GEO_LIKE_THRESHOLD;
}

function isMarginsDimension(d: BreakdownDimension): boolean {
  return d.name === 'Marges' || marginsValueMember(d.members) !== null;
}

/**
 * Classifies a dimension for the resolver's own routing. 'time' and 'geo'
 * come straight from CBS's own Kind (never re-derived); 'margins' and
 * 'geo_like' are measured conventions checked on the member list; everything
 * else still needing the total rule is 'breakdown'.
 */
export function classifyDimension(d: BreakdownDimension): DimensionClass {
  if (d.kind === 'TimeDimension') return 'time';
  if (d.kind === 'GeoDimension') return 'geo';
  if (isMarginsDimension(d)) return 'margins';
  if (isGeoLikeDimension(d.members)) return 'geo_like';
  return 'breakdown';
}

export interface StatedDefault {
  dimension: string;
  dimensionTitle: string;
  code: string;
  memberTitle: string;
}

export interface BreakdownQuestion {
  dimension: string;
  dimensionTitle: string;
  /** CBS order; at most BREAKDOWN_OPTION_CAP. */
  options: BreakdownMember[];
  /** How many members the dimension actually has (may exceed options.length). */
  totalOptions: number;
}

/** Upper bound on how many member options a breakdown question shows as
 * buttons — measured/chosen so the question stays a one-screen button row
 * rather than degrading into a scroll (cheapest-mechanism-first convention,
 * CLAUDE.md). */
export const BREAKDOWN_OPTION_CAP = 12;

export type BreakdownResolution =
  | { ok: true; coordinates: Record<string, string>; defaults: StatedDefault[]; callerDimensions: string[] }
  | { ok: false; question: BreakdownQuestion };

/** A dimension's title, falling back to its name when the title is empty or
 * whitespace-only (F4) — CBS's own title is preferred verbatim, but a
 * question or stated default must never show an empty label or double up a
 * ": " separator. Never guesses a DIFFERENT word: the dimension's own `name`
 * (its stable identifier) is not a guess. */
function dimensionLabel(d: Pick<BreakdownDimension, 'name' | 'title'>): string {
  return d.title.trim().length > 0 ? d.title : d.name;
}

/** A button question for one dimension: its FIRST BREAKDOWN_OPTION_CAP
 * members as options and the full member count (exported for the table lane,
 * breadth step 5 #339 (7) — body unchanged). */
export function toQuestion(d: BreakdownDimension): BreakdownQuestion {
  return {
    dimension: d.name,
    dimensionTitle: dimensionLabel(d),
    options: d.members.slice(0, BREAKDOWN_OPTION_CAP),
    totalOptions: d.members.length,
  };
}

/**
 * Resolves every 'breakdown' and 'margins' dimension not already fixed in
 * `named`. 'time', 'geo' and 'geo_like' dimensions are the caller's own
 * concern (period/region resolution) and are never resolved here; their
 * names (the ones NOT already in `named`) come back as `callerDimensions`
 * (F3) so the caller knows which of its own dimensions still need handling.
 *
 * `named` is CHECKED here, never silently trusted (F2 — a caller bug must
 * never become a silent default, principle c): a key that is not one of
 * `dimensions`' own names throws (a programming error, not a data
 * ambiguity); a named code on a 'breakdown' or 'margins' dimension that is
 * not one of that dimension's own member codes becomes a question for that
 * dimension (same shape as a no-total dimension) rather than being passed
 * through. Named 'time'/'geo'/'geo_like' dimensions pass through unchecked —
 * the caller owns their coordinate space, this module has no member list to
 * validate them against for those classes' own conventions.
 *
 * The FIRST unresolvable dimension, in table (dimensions array) order,
 * becomes the question — principle (c): one clarifying question at a time,
 * never a guess for the rest.
 */
export function resolveBreakdowns(
  dimensions: BreakdownDimension[],
  named: Record<string, string>,
): BreakdownResolution {
  const dimensionNames = new Set(dimensions.map((d) => d.name));
  for (const key of Object.keys(named)) {
    if (!dimensionNames.has(key)) {
      throw new Error(`resolveBreakdowns: named dimension '${key}' is not one of this table's dimensions`);
    }
  }

  const coordinates: Record<string, string> = { ...named };
  const defaults: StatedDefault[] = [];
  const callerDimensions: string[] = [];

  for (const d of dimensions) {
    if (Object.prototype.hasOwnProperty.call(named, d.name)) {
      const cls = classifyDimension(d);
      if (cls === 'breakdown' || cls === 'margins') {
        const namedCode = named[d.name];
        const isValidMember = d.members.some((m) => m.code === namedCode);
        if (!isValidMember) {
          return { ok: false, question: toQuestion(d) };
        }
      }
      continue;
    }

    const cls = classifyDimension(d);
    if (cls === 'time' || cls === 'geo' || cls === 'geo_like') {
      callerDimensions.push(d.name);
      continue;
    }

    const resolved = cls === 'margins' ? marginsValueMember(d.members) : findGrandTotal(d.members);
    if (resolved) {
      coordinates[d.name] = resolved.code;
      defaults.push({
        dimension: d.name,
        dimensionTitle: dimensionLabel(d),
        code: resolved.code,
        memberTitle: resolved.title,
      });
      continue;
    }

    return { ok: false, question: toQuestion(d) };
  }

  return { ok: true, coordinates, defaults, callerDimensions };
}

/** One line for the answer text stating every assumed default, CBS's own
 * titles verbatim (never invented words) — null when there is nothing to
 * state. */
export function statedDefaultsText(defaults: StatedDefault[], lang: 'nl' | 'en'): string | null {
  if (defaults.length === 0) return null;
  const prefix = lang === 'nl' ? 'Uitgangspunt: ' : 'Assumed: ';
  return prefix + defaults.map((d) => `${d.dimensionTitle}: ${d.memberTitle}`).join('; ');
}

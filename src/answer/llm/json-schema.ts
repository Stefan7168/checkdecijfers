// Shared JSON-schema plumbing for structured-output calls (ADR 012's seam).
//
// Extracted session 113 (co-pilot phase 2 review round 1): this walker lived
// as a private function in src/answer/intent/schema.ts, and the co-pilot's
// own schema needed the identical rewrite — a second copy is exactly the
// drift #203 warns about, so there is ONE copy and both callers import it.
// Byte-for-byte the same transform as before the extraction, so every
// committed intent fixture's request hash is unchanged.

/**
 * zod renders discriminated unions as `oneOf`; the structured-outputs schema
 * dialect only accepts `anyOf`. Our union members are disjoint (discriminated
 * on a literal "kind"), so the rewrite is semantically identical — and it is
 * NOT optional: a schema still carrying `oneOf` is rejected by the API, so
 * every caller that generates a schema from a union must pass it through
 * here.
 */
export function oneOfToAnyOf(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(oneOfToAnyOf);
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key === 'oneOf' ? 'anyOf' : key] = oneOfToAnyOf(value);
    }
    return out;
  }
  return node;
}

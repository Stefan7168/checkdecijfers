// ADR 041 / spec Part B4: "Pro" today is a plain owner-set allowlist — the
// #205 demo switch, since no real Pro plan exists yet. Every caller (the
// embed dialog's `pro` field, the live route's Pro gate) stays unchanged
// when #205 ships a real plan; only this function's body changes. Fails
// closed: an unset env var or a caller with no email is never Pro.
export function hasProPlan(user: { id: string; email: string | null }): boolean {
  const raw = process.env.PRO_ACCOUNT_EMAILS;
  if (!raw || user.email === null) return false;
  const allowed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(user.email.toLowerCase());
}

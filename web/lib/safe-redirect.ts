// Open-redirect hardening for the magic-link auth callback (session 44
// security hunt). A caller-supplied `next` query parameter must never be able
// to send the post-login redirect off our own origin — otherwise a crafted
// link (`?next=@evil.com`, `?next=.evil.com`, `?next=//evil.com`, an absolute
// URL, or a `\`-normalisation trick) turns a genuine authenticated session into
// a convincing phishing landing on an attacker host.
//
// The naive `${origin}${next}` concatenation the callback used before was the
// bug: `@evil.com` concatenates to `https://ORIGIN@evil.com` (host `evil.com`
// via userinfo) and `.evil.com` to `https://ORIGIN.evil.com` (an attacker
// subdomain). Instead we RESOLVE `next` against our origin with the WHATWG URL
// parser and accept it only when the resolved origin is still ours — which also
// normalises `\` to `/` and collapses `//host` / absolute URLs so the origin
// check catches every off-site case. Anything else falls back to `/`.

/** Resolve a caller-supplied `next` against `origin`, returning a URL that is
 * GUARANTEED to be same-origin (falls back to the origin root on anything that
 * would leave it, or on a parse failure). */
export function safeRedirectUrl(next: string, origin: string): URL {
  try {
    const target = new URL(next, origin);
    if (target.origin === origin) return target;
  } catch {
    // malformed `next` (e.g. "javascript:...") — fall through to the root
  }
  return new URL('/', origin);
}

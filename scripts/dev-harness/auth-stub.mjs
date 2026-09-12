// Local Supabase-Auth stand-in for real-browser walks of the LOGGED-IN product (docs/RUNBOOK.md).
// Serves a JWKS + /auth/v1/user for ONE fixed test user, and writes the
// @supabase/ssr session cookie Playwright injects. No real account anywhere.
import http from 'node:http';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const PORT = 9911;
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'fleur@example.test' };
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'local', alg: 'RS256', use: 'sig' };
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const exp = now + 60 * 60 * 24 * 365;
const payload = { iss: `http://localhost:${PORT}/auth/v1`, sub: USER.id, aud: 'authenticated', role: 'authenticated', email: USER.email, exp, iat: now, session_id: '22222222-2222-4222-8222-222222222222', is_anonymous: false, aal: 'aal1', amr: [{ method: 'otp', timestamp: now }], app_metadata: { provider: 'email' }, user_metadata: {} };
const signingInput = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'local' })}.${b64(payload)}`;
const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url');
const accessToken = `${signingInput}.${signature}`;
const userJson = { id: USER.id, aud: 'authenticated', role: 'authenticated', email: USER.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_anonymous: false };
const session = { access_token: accessToken, token_type: 'bearer', expires_in: exp - now, expires_at: exp, refresh_token: 'local-refresh', user: userJson };
const cookie = { name: 'sb-localhost-auth-token', value: 'base64-' + b64(session), url: 'http://localhost:3102' };
writeFileSync(process.env.COOKIE_OUT ?? new URL('./session-cookie.json', import.meta.url), JSON.stringify([cookie]));
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  if (p.endsWith('/.well-known/jwks.json')) return json(res, 200, { keys: [jwk] });
  if (p === '/auth/v1/user' && req.method === 'GET') return json(res, 200, userJson);
  if (p === '/auth/v1/token') return json(res, 200, session);
  if (p === '/auth/v1/logout') { res.writeHead(204); return res.end(); }
  if (p === '/auth/v1/otp') return json(res, 200, {});
  if (p === '/auth/v1/health' || p === '/auth/v1/settings') return json(res, 200, { external: { email: true } });
  console.log('[auth-stub] unhandled', req.method, p);
  json(res, 404, { error: 'not found', path: p });
}).listen(PORT, () => console.log(`[auth-stub] listening on ${PORT}; user ${USER.id}; cookie written`));

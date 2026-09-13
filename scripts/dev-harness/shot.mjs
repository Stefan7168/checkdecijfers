// usage: node shot.mjs <url> <out.png> [width=375] [light|dark] [nl|en] [full|view]
// The app shell scrolls INSIDE a flex div (body is h-dvh), so "fullPage" alone
// captures one viewport: this grows the viewport to the inner scroll height first.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [url, out, w = '375', scheme = 'light', lang = 'nl', mode = 'full'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const ctx = await browser.newContext({ viewport: { width: Number(w), height: 812 }, deviceScaleFactor: 2, colorScheme: scheme === 'dark' ? 'dark' : 'light', isMobile: Number(w) < 500, hasTouch: Number(w) < 500, locale: lang === 'en' ? 'en-GB' : 'nl-NL' });
await ctx.addCookies([{ name: 'lang', value: lang, url: new URL(url).origin }]);
if (process.env.COOKIES) { const { readFileSync } = await import('node:fs'); const extra = JSON.parse(readFileSync(process.env.COOKIES, 'utf8')).map((c) => ({ ...c, url: new URL(url).origin })); await ctx.addCookies(extra); }
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(1500);
if (mode === 'full') {
  const h = await page.evaluate(() => { const el = document.querySelector('body > div > div, main')?.closest('.overflow-y-auto') ?? document.querySelector('.overflow-y-auto'); return Math.min(20000, (el ? el.scrollHeight : document.documentElement.scrollHeight) + 80); });
  await page.setViewportSize({ width: Number(w), height: Math.max(812, h) });
  await page.waitForTimeout(800);
}
const sw = await page.evaluate(() => { const el = document.querySelector('.overflow-y-auto'); return { doc: document.documentElement.scrollWidth, inner: el ? el.scrollWidth : null }; });
await page.screenshot({ path: out, fullPage: false });
console.log(JSON.stringify({ url, w, scheme, lang, scrollWidth: sw, errors }));
await browser.close();

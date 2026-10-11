// Рендер HTML-экрана в PNG (full page). Usage: node render.js <file://…/screen.html> <out.png> [width=1920] [height=1080]
const { chromium } = require('./_pw.cjs')();
(async () => {
  const [,, url, out, w = '1920', h = '1080'] = process.argv;
  if (!url || !out) { console.error('usage: node render.js <url> <out.png> [width] [height]'); process.exit(2); }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const dims = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  await page.screenshot({ path: out, fullPage: true });
  console.log(out, JSON.stringify(dims));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

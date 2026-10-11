// DOM-дефекты экрана: числа, перенесённые на 2+ строки; текст, обрезанный своим блоком; пересекающиеся карточки-соседи.
// Usage: node dom_check.js <file://…/screen.html> [width=1920]  → JSON в stdout
const { chromium } = require('./_pw.cjs')();
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +(process.argv[3] || 1920), height: 1080 } });
  await p.goto(process.argv[2], { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  const r = await p.evaluate(() => {
    const leaves = [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && (e.textContent || '').trim());
    const numRe = /^[+\-−]?[\d\s.,%$KМMk▲▼↑↓→]+(USDT|USD|%)?$/;
    const wrappedNumbers = [], clipped = [];
    for (const e of leaves) {
      const t = e.textContent.trim();
      const range = document.createRange(); range.selectNodeContents(e);
      const lines = new Set([...range.getClientRects()].map(rc => Math.round(rc.top))).size;
      if (numRe.test(t) && t.length <= 20 && lines > 1) wrappedNumbers.push(t);
      const cs = getComputedStyle(e);
      if ((cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap') && e.scrollWidth > e.clientWidth + 1) clipped.push(t.slice(0, 40));
    }
    const cards = [...document.querySelectorAll('body *')].filter(e => {
      const cs = getComputedStyle(e); const rc = e.getBoundingClientRect();
      return parseFloat(cs.borderTopLeftRadius) >= 8 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && rc.width > 120 && rc.height > 60;
    });
    let overlaps = 0; const ex = [];
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], c = cards[j];
      if (a.contains(c) || c.contains(a)) continue;
      const x = a.getBoundingClientRect(), y = c.getBoundingClientRect();
      const w = Math.min(x.right, y.right) - Math.max(x.left, y.left), h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
      if (w > 4 && h > 4) { overlaps++; if (ex.length < 3) ex.push(((a.textContent || '').trim().slice(0, 20)) + ' × ' + ((c.textContent || '').trim().slice(0, 20))); }
    }
    return { wrappedNumbers: wrappedNumbers.length, wrappedEx: wrappedNumbers.slice(0, 4), clipped: clipped.length, clippedEx: clipped.slice(0, 3),
             cardOverlaps: overlaps, overlapEx: ex, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight };
  });
  console.log(JSON.stringify(r));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });

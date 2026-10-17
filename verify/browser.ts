// Headless-browser checks of the Echo Show 8 simulator and the MCP App views (B*).
// Plays "Play demo" (?pace=fast&hold=1: the host pauses after every step until window.__release()), snapshots the
// device screen (1280x800, no frame) at every step into docs/screens/beat-N-<view>.png and every one of the 7 screens
// in the light theme (light-<view>.png, switched live through host-context-changed). Each screen is compared with the
// render of its reference (design/screens/0N-*/screen.html) and with the picked image (reference.png) using
// verify/tools/compare_to_image.py; the view document gets the dom_check.js rules (0 wrapped numbers, 0 clipped text,
// 0 overlapping cards) plus a fit check; customer screens must not show stars, "checked today", tool names, source
// badges or JSON. Before the demo: the tap path (Allow in the view -> ui/message -> consent), the host's N1/N7
// refusals without any tools/call, and "no" books nothing.
//   import { runBrowserChecks } from "./browser.ts"   (verify/run.ts)
//   node verify/browser.ts [--host http://127.0.0.1:5188/] [--out docs/screens]   (standalone, servers already running)
import { chromium, type Frame, type Page } from "playwright";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LINE_N1, LINE_N7 } from "../src/core/lint.ts";

export type Row = { id: string; check: string; expected: string; actual: string; pass: boolean };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS = join(ROOT, "verify", "tools");

/** The 7 screens: reference folder, the demo step that shows its main state, the view name. */
export const SCREENS = [
  { n: "01", dir: "01-family-match", view: "family-match", shot: "beat-2-family-match" },
  { n: "02", dir: "02-checkup-year", view: "checkup-year", shot: "beat-4-checkup-year" },
  { n: "03", dir: "03-visit-plan", view: "visit-plan", shot: "beat-3-visit-plan" },
  { n: "04", dir: "04-booked", view: "booked", shot: "beat-3-booked" },
  { n: "05", dir: "05-set-aside", view: "set-aside", shot: "beat-5-set-aside" },
  { n: "06", dir: "06-before-we-start", view: "consent", shot: "beat-1-consent" },
  { n: "07", dir: "07-developer-view", view: "developer", shot: "beat-6-developer" },
] as const;
export const EDGE_F1_MIN = 0.85;

/** Never on a customer screen (SPEC §3/§8): stars, fake freshness, tool names, internal ids, source badges, JSON. */
export const CUSTOMER_FORBIDDEN = /★|checked today|\b(find_in_network|book_visit|cancel_visit|checkup_year|check_doctor|family_plans|family_routine|doctor_notes|in_network|out_of_network|does_not_see_this_age|age_not_listed)\b|\bSBX-[0-9A-F]{8}\b|\bplan-[abc]\b|[{}]|\bLIVE\b|\bFILE\b|\bFIXTURE\b|\bSANDBOX\b|\bSIMULATED\b|\bFHIR\b|\bJSON\b|Plan [A-C] · LIVE|demo reviews|\b[1-5](\.\d)? stars?\b/;
/** Mockup placeholders that must never be shown as if real (SPEC §8 grep gate, applied to the rendered screens). */
const PLACEHOLDER_TEXT = ["318 ms", "18:40", "52/52", "37 in-network", "ZIP 328xx", "HH:MM", "n/n"];

/** dom_check.js rules, run inside a document (the view, or the host page); plus "fits its container". */
export const DOM_CHECK = (rootSel?: string) => {
  const root = (rootSel ? document.querySelector(rootSel) : document.body) as HTMLElement;
  const all = [...root.querySelectorAll("*")] as HTMLElement[];
  const leaves = all.filter((e) => e.children.length === 0 && (e.textContent || "").trim()) as HTMLElement[];
  const numRe = /^[+\-−]?[\d\s.,%$KМMk▲▼↑↓→]+(USDT|USD|%)?$/;
  const wrappedNumbers: string[] = [], clipped: string[] = [];
  for (const e of leaves) {
    const t = (e.textContent || "").trim();
    const range = document.createRange(); range.selectNodeContents(e);
    const lines = new Set([...range.getClientRects()].map((rc) => Math.round(rc.top))).size;
    if (numRe.test(t) && t.length <= 20 && lines > 1) wrappedNumbers.push(t);
    // times and dates ("9:15 AM", "Thu Oct 22") must not wrap either
    if (/^(\d{1,2}:\d{2}( [AP]M)?|(Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} \d{1,2})$/.test(t) && lines > 1) wrappedNumbers.push(t);
    const cs = getComputedStyle(e);
    if ((cs.overflow === "hidden" || cs.textOverflow === "ellipsis" || cs.whiteSpace === "nowrap") && e.scrollWidth > e.clientWidth + 1) clipped.push(t.slice(0, 40));
  }
  // a backdrop layer (the parent's free window behind the visits on 03) is not a card
  const cards = all.filter((e) => {
    const cs = getComputedStyle(e); const rc = e.getBoundingClientRect();
    return !e.closest("[data-layer='backdrop']") && parseFloat(cs.borderTopLeftRadius) >= 8 && cs.backgroundColor !== "rgba(0, 0, 0, 0)" && rc.width > 120 && rc.height > 60;
  });
  let overlaps = 0; const ex: string[] = [];
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i], c = cards[j];
    if (a.contains(c) || c.contains(a)) continue;
    const x = a.getBoundingClientRect(), y = c.getBoundingClientRect();
    const w = Math.min(x.right, y.right) - Math.max(x.left, y.left), h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
    if (w > 4 && h > 4) { overlaps++; if (ex.length < 3) ex.push(`${(a.textContent || "").trim().slice(0, 20)} × ${(c.textContent || "").trim().slice(0, 20)}`); }
  }
  // fit: nothing of the content lies below the bottom or right edge of the window (the iframe / the page)
  // (boxes cut by scrolling ancestors inside the root; the bound is the window, or the root's own box)
  const vis = (e: Element) => {
    const r = e.getBoundingClientRect(); let B = r.bottom, R = r.right;
    for (let p = e.parentElement; p && p !== root.parentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (p !== root && (cs.overflowY === "auto" || cs.overflowY === "scroll")) { const q = p.getBoundingClientRect(); B = Math.min(B, q.bottom); R = Math.min(R, q.right); }
    }
    return { bottom: B, right: R };
  };
  const bound = rootSel ? root.getBoundingClientRect() : { bottom: innerHeight, right: innerWidth };
  const bottom = Math.max(0, ...all.map((e) => vis(e).bottom)) - (rootSel ? bound.bottom - innerHeight : 0);
  const right = Math.max(0, ...all.map((e) => vis(e).right)) - (rootSel ? bound.right - innerWidth : 0);
  const imgs = root.querySelectorAll("img").length;
  const brandSvg = [...root.querySelectorAll("svg")].filter((s) => /alexa|amazon|echo|ring|aetna|cigna|humana|molina|florida blue|unitedhealth/i.test(`${s.getAttribute("aria-label") ?? ""} ${s.querySelector("title")?.textContent ?? ""}`)).length;
  return { wrappedNumbers: wrappedNumbers.length, wrappedEx: wrappedNumbers.slice(0, 4), clipped: clipped.length, clippedEx: clipped.slice(0, 3), cardOverlaps: overlaps, overlapEx: ex,
    overflowY: Math.round(bottom - innerHeight), overflowX: Math.round(right - innerWidth), imgs, brandSvg, text: root.innerText,
    zoom: document.body.dataset.zoom ?? "", theme: document.documentElement.dataset.theme ?? "", deviceClass: document.body.dataset.deviceClass ?? "", fonts: [...document.fonts].map((f) => `${f.weight}:${f.status}`).join(" ") };
};
type Dom = ReturnType<typeof DOM_CHECK>;
const domOk = (d: Dom) => d.wrappedNumbers === 0 && d.clipped === 0 && d.cardOverlaps === 0 && d.overflowY <= 1 && d.overflowX <= 1 && d.imgs === 0 && d.brandSvg === 0;
const domStr = (d: Dom) => `w${d.wrappedNumbers} c${d.clipped} o${d.cardOverlaps} fitY${d.overflowY <= 1 ? "ok" : `+${d.overflowY}`}${d.wrappedEx.length ? ` wrapped=${d.wrappedEx.join("/")}` : ""}${d.clippedEx.length ? ` clipped=${d.clippedEx.join("/")}` : ""}${d.overlapEx.length ? ` overlaps=${d.overlapEx.join("/")}` : ""}${d.imgs ? ` img=${d.imgs}` : ""}${d.brandSvg ? ` brandSvg=${d.brandSvg}` : ""}`;

function compare(refPng: string, shotPng: string, outPng: string): { edgeF1: number; lumaMAE: number; raw: string } {
  const r = spawnSync("python3", [join(TOOLS, "compare_to_image.py"), refPng, shotPng, outPng], { encoding: "utf8" });
  const m = (r.stdout ?? "").match(/edgeF1=([\d.]+) lumaMAE=([\d.]+)/);
  return { edgeF1: m ? Number(m[1]) : NaN, lumaMAE: m ? Number(m[2]) : NaN, raw: (r.stdout || r.stderr || "").trim().slice(0, 200) };
}

/** Renders each reference screen.html (dark and light) at 1280x800 with the repository's Nunito. */
async function renderReferences(page: Page, outDir: string): Promise<Record<string, { dark: string; light: string; picked: string }>> {
  const tmp = mkdtempSync(join(tmpdir(), "innetwork-ref-"));
  const out: Record<string, { dark: string; light: string; picked: string }> = {};
  try {
    for (const s of SCREENS) {
      const src = join(ROOT, "design", "screens", s.dir);
      if (!existsSync(join(src, "screen.html"))) continue;
      const d = join(tmp, s.dir);
      mkdirSync(d, { recursive: true });
      copyFileSync(join(src, "screen.html"), join(d, "screen.html"));
      symlinkSync(join(ROOT, "design", "fonts"), join(d, "fonts"));
      const files = { dark: join(outDir, `ref-${s.n}-dark.png`), light: join(outDir, `ref-${s.n}-light.png`), picked: join(src, "reference.png") };
      for (const theme of ["dark", "light"] as const) {
        await page.goto(`${pathToFileURL(join(d, "screen.html")).href}${theme === "light" ? "?theme=light" : ""}`, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(150);
        await page.screenshot({ path: files[theme], clip: { x: 0, y: 0, width: 1280, height: 800 } });
      }
      out[s.n] = files;
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  return out;
}

export async function runBrowserChecks(opts: { hostUrl: string; screensDir: string; mcpUrl?: string }, log: (s: string) => void): Promise<Row[]> {
  const rows: Row[] = [];
  const add = (id: string, check: string, expected: string, actual: string, pass: boolean) => { rows.push({ id, check, expected, actual, pass }); log(`${pass ? "PASS" : "FAIL"} ${id} ${check} :: ${actual}`); };
  const shotsDir = opts.screensDir;
  const workDir = join(ROOT, "logs", "screens-compare");
  mkdirSync(shotsDir, { recursive: true });
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  for (const f of readdirSync(shotsDir)) if (/^(beat-\d|light-).*\.png$/.test(f)) rmSync(join(shotsDir, f));

  const browser = await chromium.launch({ headless: true });
  const consoleErrors: string[] = [];
  const mcpCalls: { method: string; tool: string | null; t: number }[] = [];
  const shots: string[] = [];
  const doms: Record<string, Dom> = {};
  const hostDoms: string[] = [];
  const forbidden: string[] = [];
  const subtitleLog: { text: string; seconds: string; t: number }[] = [];
  const bands: Record<string, string> = {};
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "dark" });
    page.setDefaultTimeout(20_000);
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
    await page.exposeFunction("__subtitle", (text: string, seconds: string) => subtitleLog.push({ text, seconds, t: Date.now() }));
    const user = `web-${Date.now().toString(36)}`;
    await page.goto(`${opts.hostUrl}?user=${user}&pace=fast&hold=1`);
    await page.waitForSelector("body[data-connected='1']");
    const cfg = await page.evaluate(() => (window as any).__INNET as { mcpUrl: string; devinfoUrl: string; sandboxProxyUrl: string });
    const mcpUrl = opts.mcpUrl ?? cfg.mcpUrl;
    page.on("request", (r) => {
      if (!r.url().startsWith(mcpUrl)) return;
      let method = r.method(), tool: string | null = null;
      try { const j = JSON.parse(r.postData() ?? ""); method = j.method ?? method; tool = j.params?.name ?? null; } catch { /* GET/DELETE */ }
      mcpCalls.push({ method, tool, t: Date.now() });
    });
    await page.evaluate(() => {
      const el = document.getElementById("sub-alexa")!;
      let last = "";
      new MutationObserver(() => {
        const t = (el.textContent ?? "").trim();
        if (t && t !== last) { last = t; (window as any).__subtitle(t, document.getElementById("sub-seconds")!.textContent ?? ""); }
      }).observe(document.getElementById("subtitles")!, { subtree: true, childList: true, characterData: true });
    });
    const host = () => page.evaluate(() => (window as any).__host);
    const h0 = await host();
    add("B1", "host connects with the official MCP client (Streamable HTTP, simulated account link)", 'protocol "2025-11-25", session id, 9 tools',
      `protocol=${h0.protocolVersion} session=${String(h0.sessionId).slice(0, 8)}… tools=${h0.tools.length}`, h0.protocolVersion === "2025-11-25" && /^[0-9a-f-]{36}$/.test(h0.sessionId) && h0.tools.length === 9);

    // page frame: caption, persistent "simulated" mark, a 1280x800 screen, no logos, no page scroll
    const frame = await page.evaluate(() => {
      const r = document.getElementById("screen")!.getBoundingClientRect();
      return { caption: document.querySelector(".frame-caption")?.textContent ?? "", mark: document.querySelector(".sim-mark")?.textContent ?? "", w: r.width, h: r.height,
        imgs: document.querySelectorAll("img").length, scrollX: document.documentElement.scrollWidth - innerWidth, scrollY: document.documentElement.scrollHeight - innerHeight };
    });
    add("B2", "device frame: caption, permanent simulated mark, true 1280x800 screen, no images/logos, no page scroll at 1920x1080", '"Echo Show 8 simulator (1280x800 frame)" · "Alexa+ simulated in our web host · Alexa voice: synthetic" · 1280x800 · 0 img · no scroll',
      `"${frame.caption}" · "${frame.mark}" · ${frame.w}x${frame.h} · ${frame.imgs} img · scroll ${frame.scrollX}/${frame.scrollY}`,
      frame.caption === "Echo Show 8 simulator (1280x800 frame)" && frame.mark === "Alexa+ simulated in our web host · Alexa voice: synthetic" && frame.w === 1280 && frame.h === 800 && frame.imgs === 0 && frame.scrollX <= 0 && frame.scrollY <= 0);

    const viewFrame = (): Frame | undefined => page.frames().filter((f) => !f.isDetached() && f.parentFrame()?.url().includes("/sandbox.html")).at(-1);
    async function viewReady(view: string): Promise<Frame> {
      await page.waitForFunction((v) => document.querySelector(`#card iframe[data-view='${v}']`) !== null, view);
      let f: Frame | undefined;
      for (let i = 0; i < 50 && !f; i++) { f = viewFrame(); if (!f) await page.waitForTimeout(50); }
      if (!f) throw new Error(`no view frame for ${view}`);
      await f.waitForFunction((v) => document.body.dataset.view === v && document.body.dataset.connected === "1", view);
      await f.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(120);
      return f;
    }
    const say = async (text: string) => page.evaluate((t) => (window as any).__hostApi.say(t), text);
    const turns = async () => (await host()).turns as any[];

    // ---- before the demo: tap path, host refusals (no tool call), "no" books nothing ----
    await say("Alexa, open In Network.");
    const cf = await viewReady("consent");
    const before = mcpCalls.length;
    await cf.click("button.btn-allow");
    await page.waitForFunction(() => { const t = (window as any).__host.turns.at(-1); return t?.source === "tap" && t?.tool === "consent" && document.body.dataset.busy === "0"; });
    const tapTurn = (await turns()).at(-1);
    add("B3", "tap in the view: Allow -> ui/message -> host turn -> consent(allow)", 'turn source "tap", consent {action:"allow"}, a tools/call went out',
      `source=${tapTurn.source} tool=${tapTurn.tool} args=${JSON.stringify(tapTurn.args)} calls+${mcpCalls.slice(before).filter((c) => c.method === "tools/call").length}`, tapTurn.source === "tap" && tapTurn.tool === "consent" && tapTurn.args?.action === "allow" && mcpCalls.slice(before).some((c) => c.tool === "consent"));

    const c0 = mcpCalls.filter((c) => c.method === "tools/call").length;
    const n1 = await say("Alexa, my tummy hurts. Who should I see?");
    const n7 = await say("Alexa, this is an emergency.");
    const c1 = mcpCalls.filter((c) => c.method === "tools/call").length;
    add("B4", "host refusals N1 (symptom, no specialty) and N7 (emergency): fixed lines, spoken without any tools/call", `"${LINE_N1}" · "${LINE_N7}" · 0 tools/call`,
      `"${n1?.speech}" · "${n7?.speech}" · ${c1 - c0} tools/call`, n1?.speech === LINE_N1 && n7?.speech === LINE_N7 && c1 === c0 && n1?.tool === null && n7?.tool === null);

    await say("Alexa, find an orthopedist for my youngest. He's under two.");
    await viewReady("set-aside");
    const c2 = mcpCalls.length;
    const no = await say("No.");
    add("B5", '"no" with a proposal waiting books nothing', 'no book_visit call; "OK, I won\'t book anything."', `${mcpCalls.slice(c2).filter((c) => c.tool === "book_visit").length} book_visit · "${no?.speech}"`,
      !mcpCalls.slice(c2).some((c) => c.tool === "book_visit") && no?.speech === "OK, I won't book anything.");

    // sandbox: second origin, CSP header from _meta.ui.csp, the view cannot reach the host document
    const sb = await page.evaluate(() => { const f = document.querySelector("#card iframe") as HTMLIFrameElement; return { src: f.src, sandbox: f.getAttribute("sandbox"), hostOrigin: location.origin }; });
    const cspHeader = (await fetch(sb.src)).headers.get("content-security-policy") ?? "";
    const vf = viewFrame()!;
    const reach = await vf.evaluate(() => { try { void (window.top as Window).document.title; return "reachable"; } catch { return "blocked"; } });
    const mcpOrigin = new URL(mcpUrl).origin;
    add("B6", "views run in a sandbox proxy on a second origin; CSP from the view's _meta.ui.csp; host document unreachable from the view", `origin ≠ ${sb.hostOrigin}; default-src 'none'; font-src has ${mcpOrigin}; blocked`,
      `origin=${new URL(sb.src).origin} sandbox="${sb.sandbox}" csp="${cspHeader.split(";").filter((x) => /default-src|font-src|connect-src/.test(x)).join(";").trim()}" top=${reach}`,
      new URL(sb.src).origin !== sb.hostOrigin && /default-src 'none'/.test(cspHeader) && new RegExp(`font-src[^;]*${mcpOrigin.replace(/[.:/]/g, "\\$&")}`).test(cspHeader) && /connect-src 'none'/.test(cspHeader) && reach === "blocked");

    // ---- Play demo with holds ----
    const refs = await renderReferences(await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }), workDir);
    const screenEl = async () => (await page.$("#screen"))!;
    const named = new Set<string>();
    const lightDone = new Set<string>();
    const steps: string[] = [];
    let themeOk = 0, themeTried = 0;
    await page.click("#play-demo");
    for (let guard = 0; guard < 30; guard++) {
      await page.waitForFunction(() => !!document.body.dataset.hold || ["done", "failed"].includes(document.body.dataset.demo ?? ""), undefined, { timeout: 60_000 });
      const hold = await page.evaluate(() => document.body.dataset.hold ?? "");
      if (!hold) break;
      const m = hold.match(/^beat-(\d+)-([a-z-]+?)(?:-(\d+))?$/)!;
      const beat = Number(m[1]), view = m[2];
      let name = `beat-${beat}-${view}`;
      if (named.has(name)) name = view === "family-match" ? `${name}-booked` : view === "consent" ? `${name}-allowed` : `${name}-${m[3]}`;
      named.add(name);
      steps.push(name);
      let f: Frame | undefined;
      if (view === "developer") await page.waitForSelector("#devboard:not([hidden]) .db");
      else if (view !== "voice") f = await viewReady(view);
      const file = join(shotsDir, `${name}.png`);
      await (await screenEl()).screenshot({ path: file });
      shots.push(file);
      if (f) {
        const d = await f.evaluate(DOM_CHECK);
        doms[name] = d;
        const band = await page.evaluate(() => [document.getElementById("band-ask")!.textContent, document.getElementById("band-reply-1")!.textContent, document.getElementById("band-reply-2")!.textContent].join(" | "));
        const text = `${d.text}\n${band}`;
        const bad = text.match(CUSTOMER_FORBIDDEN);
        if (bad) forbidden.push(`${name}: "${bad[0]}"`);
      }
      bands[name] = await page.evaluate(() => document.getElementById("chrome")!.hidden || document.body.dataset.mode === "developer" ? "" : [document.getElementById("band-ask")!.textContent, document.getElementById("band-reply-1")!.textContent, document.getElementById("band-reply-2")!.textContent].filter(Boolean).join(" | "));
      const hd = await page.evaluate(`(${DOM_CHECK.toString()})()`) as Dom;
      hostDoms.push(`${name}: ${domStr(hd)}`);
      if (view === "developer") {
        const devText = await page.evaluate(() => document.getElementById("devboard")!.innerText);
        for (const p of PLACEHOLDER_TEXT) if (devText.includes(p)) forbidden.push(`${name}: placeholder "${p}"`);
        doms[name] = await page.evaluate(`(${DOM_CHECK.toString()})("#devboard")`) as Dom;
      }
      // light theme, once per screen, switched live (host-context-changed reaches the view)
      const primary = SCREENS.find((s) => s.shot === name);
      if (primary && !lightDone.has(primary.view)) {
        lightDone.add(primary.view);
        themeTried++;
        await page.click("#theme");
        if (f) await f.waitForFunction(() => document.documentElement.dataset.theme === "light", undefined, { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(200);
        const viewTheme = f ? await f.evaluate(() => document.documentElement.dataset.theme) : "n/a";
        if ((await page.evaluate(() => document.documentElement.dataset.theme)) === "light" && (viewTheme === "light" || viewTheme === "n/a")) themeOk++;
        const lf = join(shotsDir, `light-${primary.view}.png`);
        await (await screenEl()).screenshot({ path: lf });
        shots.push(lf);
        if (f) { const d = await f.evaluate(DOM_CHECK); doms[`light-${primary.view}`] = d; }
        await page.click("#theme");
        if (f) await f.waitForFunction(() => document.documentElement.dataset.theme === "dark", undefined, { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(120);
      }
      await page.evaluate(() => (window as any).__release());
    }
    await page.waitForFunction(() => ["done", "failed"].includes(document.body.dataset.demo ?? ""), undefined, { timeout: 60_000 });
    const hEnd = await host();
    const demoTurns = (hEnd.turns as any[]).filter((t) => t.source === "demo");
    add("B7", "Play demo reaches done: every beat answered without an error, views in order", 'data-demo="done"; views consent, consent, family-match, family-match, visit-plan, booked, checkup-year, set-aside; then behind the scenes',
      `demo=${await page.evaluate(() => document.body.dataset.demo)} · views ${demoTurns.map((t) => t.view ?? "-").join(", ")} · errors ${hEnd.errors.length ? hEnd.errors.join("/") : 0} · steps ${steps.join(",")}`,
      (await page.evaluate(() => document.body.dataset.demo)) === "done" && demoTurns.map((t) => t.view).join(",") === "consent,consent,family-match,family-match,visit-plan,booked,checkup-year,set-aside" && demoTurns.every((t) => !t.isError) && hEnd.errors.length === 0 && steps.includes("beat-6-developer"));

    // conversation band drawn by the host, per screen (STYLE: 01/02 framed, 05 open with two short lines, 03 quote only, 04/06 none)
    const EXPECT_BAND: [string, string][] = [
      ["beat-1-consent", ""],
      ["beat-2-family-match", "“Alexa, I need a gastroenterologist, an allergist for my five-year-old, and an orthopedist for my little one. He's under two.” | One doctor each, in their own plan. Book all three?"],
      ["beat-2-family-match-booked", "“Yes.” | Booked."],
      ["beat-3-visit-plan", "“Book them all before my plan resets.”"],
      ["beat-3-booked", ""],
      ["beat-4-checkup-year", "“Alexa, what's left on my checkup plan?” | Four booked. Lab work comes after Tuesday's visit."],
      ["beat-5-set-aside", "“Alexa, find an orthopedist for my youngest. He's under two.” | I checked six nearby. | Two don't see children under three, one isn't in his plan. These two fit."],
    ];
    const bandMiss = EXPECT_BAND.filter(([k, v]) => bands[k] !== v).map(([k, v]) => `${k}: got "${bands[k]}" want "${v}"`);
    add("B18", "conversation band per screen: framed request + reply (01, 02), open request + two short lines (05), quote of the request's last sentence (03), none (04, 06)", "7/7 as specified",
      bandMiss.length ? bandMiss.join(" | ") : `${EXPECT_BAND.length}/${EXPECT_BAND.length}`, bandMiss.length === 0);
    const planTurn = demoTurns.find((t) => t.tool === "checkup_year" && t.view === "visit-plan");
    // Scene 1 is one part since 2026-10-17 (the out-of-pocket line moved to the screen); the check still walks every part.
    const planParts: string[] = planTurn?.parts ?? [];
    const idx = planParts.map((t) => subtitleLog.findIndex((x) => x.text === t));
    const secOk = planParts.every((_, i) => idx[i] >= 0 && subtitleLog[idx[i]]?.seconds === `${Number(planTurn!.seconds[i]).toFixed(1)} s`);
    add("B8", "speech parts of scene 1 shown one after the other in the subtitle bar, each with its own seconds", "every part in order, seconds from structuredContent.seconds",
      `parts=${planParts.length} order=${idx.join("<")} seconds=${idx.map((j) => `"${subtitleLog[j]?.seconds}"`).join(",")} vs ${JSON.stringify(planTurn?.seconds)}`,
      planParts.length >= 1 && idx.every((j, i) => j >= 0 && (i === 0 || j > idx[i - 1])) && secOk);

    add("B9", "MCP Apps lifecycle: every card view initialized before data; ui/resource-teardown before each view change", "initialized = renders; teardowns = renders - 1 (per household) or more",
      `renders=${hEnd.card.renders} initialized=${hEnd.card.initialized} teardowns=${hEnd.card.teardowns}`, hEnd.card.renders > 0 && hEnd.card.initialized === hEnd.card.renders && hEnd.card.teardowns >= hEnd.card.renders - 1);

    add("B10", "theme switch goes out as host-context-changed and the view re-themes (light snapshot of all 7 screens)", `7/7 switched (host + view), 7 light shots`, `${themeOk}/${themeTried} switched · light shots ${shots.filter((s) => /light-/.test(s)).length}`, themeOk === 7 && themeTried === 7);

    const zooms = Object.entries(doms).filter(([k]) => !k.includes("developer")).map(([k, d]) => `${k}:${d.zoom}/${d.deviceClass}`);
    add("B11", "views take zoom from hostContext deviceClass echo-show-8 (base 768x480 x 1.667), Nunito loaded", "zoom 1.667 everywhere; 4 Nunito faces loaded",
      `${zooms.length} views · zoom ${[...new Set(Object.entries(doms).filter(([k]) => !k.includes("developer")).map(([, d]) => d.zoom))].join("/")} · fonts ${doms["beat-2-family-match"]?.fonts ?? "?"}`,
      Object.entries(doms).filter(([k]) => !k.includes("developer")).every(([, d]) => d.zoom === "1.667" && d.deviceClass === "echo-show-8") && /400:loaded/.test(doms["beat-2-family-match"]?.fonts ?? "") && /700:loaded/.test(doms["beat-2-family-match"]?.fonts ?? ""));

    const domRows = Object.entries(doms).map(([k, d]) => `${k} ${domStr(d)}`);
    add("B12", "dom_check on every view document (dark + light) and on the board: 0 wrapped numbers/times, 0 clipped, 0 overlapping cards, fits the screen, no img, no brand marks", "all clean",
      domRows.filter((r) => !/ w0 c0 o0 fitYok$/.test(r)).join(" | ") || `${domRows.length} documents clean`, Object.values(doms).every(domOk));
    add("B13", "host page dom_check at every step (subtitles, band, developer view): 0 wrapped numbers, 0 clipped, 0 overlaps, nothing below 1080 px", "every step clean",
      hostDoms.filter((r) => !/w0 c0 o0 fitYok/.test(r)).join(" | ") || `${hostDoms.length} steps clean`, hostDoms.every((r) => /w0 c0 o0 fitYok/.test(r)));
    add("B14", 'customer screens: no stars, "checked today", tool names, ids, source badges, JSON; board: no mockup placeholders', "0 hits", forbidden.length ? forbidden.join(" | ") : `0 hits in ${Object.keys(doms).length} screens`, forbidden.length === 0);

    // screen 07 numbers come from /devinfo
    const dev = await (await fetch(cfg.devinfoUrl)).json() as { verify: { pass: number; total: number } | null; probes: Record<string, { ok: boolean; ms: number }>; directoryMode: string };
    const expVerify = dev.verify ? `verify ${dev.verify.pass}/${dev.verify.total} ${dev.verify.pass === dev.verify.total ? "PASS" : "· FAIL"}` : "verify — not run yet";
    const okProbe = Object.values(dev.probes).some((p) => p.ok);
    const boardText = await page.evaluate(() => document.getElementById("devboard")!.innerText);
    // the footer's audit number must be the NEWEST docs/AUDIT-*.json, read here straight from the file (not through /devinfo)
    const auditFiles = readdirSync(join(ROOT, "docs")).filter((f) => /^AUDIT-.*\.json$/.test(f)).sort();
    const auditTot = auditFiles.length ? (JSON.parse(readFileSync(join(ROOT, "docs", auditFiles.at(-1)!), "utf8")) as { totals: { records: number; age_policy_published: number } }).totals : null;
    const expAudit = auditTot ? `audit: ${auditTot.age_policy_published.toLocaleString("en-US")} of ${auditTot.records.toLocaleString("en-US")} directory records state a patient age` : null;
    add("B15", "behind the scenes (07): verify, live probe and audit lines are what /devinfo and the newest docs/AUDIT-*.json say (no placeholder numbers)", `"${expVerify}" · ${okProbe ? "live probe line with ms" : '"no live directory call in this run"'} · "${expAudit ?? "no audit file"}"`,
      `${hEnd.devboard.verify} · probe ${hEnd.devboard.probe} · mode ${dev.directoryMode} · ${/audit: [^\n]*/.exec(boardText)?.[0] ?? "no audit line"}`, hEnd.devboard.verify === expVerify && boardText.includes(expVerify) && (okProbe ? / ms · as of /.test(boardText) : /no live directory call in this run/.test(boardText)) && (expAudit === null || boardText.includes(expAudit)));

    // ---- comparisons with the references ----
    const cmp: string[] = [];
    let cmpOk = true;
    const metrics: Record<string, unknown> = {};
    for (const s of SCREENS) {
      const shot = join(shotsDir, `${s.shot}.png`);
      const ref = refs[s.n];
      if (!ref || !existsSync(shot)) { cmp.push(`${s.n}: missing ${!ref ? "reference" : "shot"}`); cmpOk = false; continue; }
      const a = compare(ref.dark, shot, join(workDir, `compare-${s.n}-dark.png`));
      const b = compare(ref.picked, shot, join(workDir, `compare-${s.n}-picked.png`));
      const l = compare(ref.light, join(shotsDir, `light-${s.view}.png`), join(workDir, `compare-${s.n}-light.png`));
      metrics[s.n] = { view: s.view, shot: `${s.shot}.png`, vsReferenceHtml: a, vsPickedImage: b, lightVsReferenceHtml: l, dom: doms[s.shot] ? domStr(doms[s.shot]) : null };
      cmp.push(`${s.n} ${s.view}: html ${a.edgeF1}/${a.lumaMAE} · light ${l.edgeF1}/${l.lumaMAE} · picked ${b.edgeF1}/${b.lumaMAE}`);
      if (!(a.edgeF1 >= EDGE_F1_MIN)) cmpOk = false;
    }
    writeFileSync(join(workDir, "metrics.json"), JSON.stringify(metrics, null, 2));
    add("B16", `each of the 7 screens vs the render of its reference screen.html: edgeF1 ≥ ${EDGE_F1_MIN} (compare_to_image.py; also vs reference.png and the light theme, reported)`, `7/7 ≥ ${EDGE_F1_MIN}`, cmp.join(" | "), cmpOk);
    add("B17", "no console errors on the host page or in the views", "0", consoleErrors.length ? consoleErrors.slice(0, 3).join(" | ") : "0", consoleErrors.length === 0);

    // must-light controls on SYNTHETIC input: the checks above can see what they claim is absent
    const ctl = await browser.newPage({ viewport: { width: 800, height: 400 } });
    await ctl.setContent(`<html><body style="margin:0;font:16px sans-serif">
      <p style="width:24px">12 345 678</p><p style="width:30px">9:15 AM</p>
      <div style="width:60px;white-space:nowrap;overflow:hidden">Dr. Wendeline Hartsworth</div>
      <div style="position:absolute;left:100px;top:100px;width:200px;height:100px;border-radius:12px;background:#222">card one</div>
      <div style="position:absolute;left:150px;top:150px;width:200px;height:100px;border-radius:12px;background:#333">card two</div>
      <div style="position:absolute;left:10px;top:380px;height:80px">below the screen</div><img alt=""></body></html>`);
    const c = await ctl.evaluate(DOM_CHECK);
    await ctl.close();
    const synth = 'Dr. A ★★★★ · checked today · find_in_network · Plan A · LIVE FHIR · {"a":1} · SBX-1A2B3C4D';
    const hits = synth.split(" · ").filter((x) => CUSTOMER_FORBIDDEN.test(x)).length;
    const clean = "Dr. Imogen Pellworth · in Plan C's network · sees this age · Mon Oct 19 · 1:30 PM · No ratings. · Booked · Your note: \"great with kids\"";
    add("B19", "controls: the dom check and the forbidden-text check light on synthetic defects and stay dark on real customer text", "wrapped ≥2, clipped ≥1, overlaps ≥1, overflow > 0, img 1; forbidden 6/6 synthetic, 0 on clean text",
      `wrapped ${c.wrappedNumbers} clipped ${c.clipped} overlaps ${c.cardOverlaps} overflowY ${c.overflowY} img ${c.imgs}; forbidden ${hits}/6, clean ${CUSTOMER_FORBIDDEN.test(clean) ? "HIT" : "0"}`,
      c.wrappedNumbers >= 2 && c.clipped >= 1 && c.cardOverlaps >= 1 && c.overflowY > 0 && c.imgs === 1 && hits === 6 && !CUSTOMER_FORBIDDEN.test(clean));
    log(`screenshots -> ${shots.map((s) => s.replace(`${ROOT}/`, "")).join(", ")}`);
    log(`side-by-side compares -> ${workDir.replace(`${ROOT}/`, "")}/compare-*.png, metrics.json`);
  } catch (err) {
    add("B0", "browser run", "no exception", String((err as Error).stack ?? err).slice(0, 400), false);
  } finally {
    await browser.close();
  }
  return rows;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const hostUrl = arg("--host", `http://127.0.0.1:${process.env.HOST_PORT ?? 5188}/`);
  const screensDir = join(ROOT, arg("--out", "docs/screens"));
  const rows = await runBrowserChecks({ hostUrl, screensDir }, console.log);
  const failed = rows.filter((r) => !r.pass).length;
  console.log(`\nBROWSER ${rows.length} checks: ${rows.length - failed} PASS, ${failed} FAIL`);
  writeFileSync(join(ROOT, "logs", "browser-latest.json"), JSON.stringify(rows, null, 2));
  process.exit(failed ? 1 : 0);
}

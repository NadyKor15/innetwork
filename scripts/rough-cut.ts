// npm run rough-cut — silent rough cut of the demo video in the order of the video script (SPEC §2):
//   cold open (beat 2) -> intro title cards -> scene 1 (beats 3-4) -> scene 2 (beat 5) -> consent (beat 1) ->
//   evidence (beat 6) -> end card. Input: docs/video/innetwork-demo-beats.json + the silent recording (npm run record).
// Output: docs/video/innetwork-rough-cut.mp4 + innetwork-rough-cut.srt (mom lines, Alexa lines, card texts) + report.
// The intro is Nadya's voice (recorded later); in this cut it is a caption only. Title-card numbers come from the
// audit JSON; without it the run stops unless --draft (then a "DRAFT" mark is drawn on the card).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VID = join(ROOT, "docs", "video");
const WORK = join(VID, ".work");
const DRAFT = process.argv.includes("--draft");
type Beats = { video: string; durationMs: number; beats: { beat: number; label: string; startMs: number; endMs: number }[]; cues: { atMs: number; who: "mom" | "alexa"; text: string; beat: number }[] };

function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 6).join(" ")} … failed: ${r.stderr.slice(-600)}`);
  return r.stdout + r.stderr;
}
const dur = (f: string) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).trim());

function auditNumber(): { records: number; withAge: number; file: string } | null {
  const docs = join(ROOT, "docs");
  const files = existsSync(docs) ? readdirSync(docs).filter((f) => /^AUDIT-.*\.json$/.test(f) && !/SITES/i.test(f)).sort() : [];
  if (!files.length) return null;
  const j = JSON.parse(readFileSync(join(docs, files.at(-1)!), "utf8")) as { totals?: { records?: number; age_policy_published?: number }; control?: { synthetic_age_record_counted?: boolean } };
  const s = j.totals ?? {};
  if (j.control?.synthetic_age_record_counted !== true) return null; // the counter must be shown to work before its zero goes on a card
  return typeof s.records === "number" && typeof s.age_policy_published === "number" ? { records: s.records, withAge: s.age_policy_published, file: files.at(-1)! } : null;
}

const FONT = (w: number) => pathToFileURL(join(ROOT, "design", "fonts", `nunito-latin-${w}-normal.woff2`)).href;
function cardHtml(lines: { text: string; size: number; weight?: number; dim?: boolean }[], foot?: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Nunito;src:url(${FONT(400)}) format("woff2");font-weight:400}
@font-face{font-family:Nunito;src:url(${FONT(700)}) format("woff2");font-weight:700}
@font-face{font-family:Nunito;src:url(${FONT(800)}) format("woff2");font-weight:800}
html,body{margin:0;width:1920px;height:1080px;background:#14181E;color:#fff;font-family:Nunito,system-ui,sans-serif}
.wrap{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 200px;gap:28px}
.mark{position:absolute;left:200px;top:120px;display:flex;gap:0}.mark i{width:44px;height:44px;border-radius:50%;margin-right:-10px;display:block}
.foot{position:absolute;left:200px;bottom:110px;font-size:28px;color:rgba(255,255,255,.6)}
.draft{position:absolute;right:80px;top:60px;font-size:30px;font-weight:800;color:#F2D06B;border:3px dashed #F2D06B;padding:6px 18px;border-radius:12px}
</style></head><body><div class="mark"><i style="background:#FF8C6B"></i><i style="background:#B49CFF"></i><i style="background:#4FD1C5"></i></div>
<div class="wrap">${lines.map((l) => `<div style="font-size:${l.size}px;font-weight:${l.weight ?? 800};line-height:1.2;color:${l.dim ? "rgba(255,255,255,.72)" : "#fff"}">${l.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`).join("")}</div>
${foot ? `<div class="foot">${foot}</div>` : ""}${DRAFT ? `<div class="draft">DRAFT</div>` : ""}</body></html>`;
}

async function renderCards(cards: { id: string; html: string }[]): Promise<Record<string, string>> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const out: Record<string, string> = {};
  for (const c of cards) {
    const f = join(WORK, `card-${c.id}.html`);
    writeFileSync(f, c.html);
    await page.goto(pathToFileURL(f).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    out[c.id] = join(WORK, `card-${c.id}.png`);
    await page.screenshot({ path: out[c.id] });
  }
  await browser.close();
  return out;
}

const srtTime = (ms: number) => { const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000), r = Math.round(ms % 1000); return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(r).padStart(3, "0")}`; };

async function main() {
  const beatsFile = join(VID, "innetwork-demo-beats.json");
  if (!existsSync(beatsFile)) throw new Error(`${beatsFile} missing - run "npm run demo" and "npm run record" first`);
  const b = JSON.parse(readFileSync(beatsFile, "utf8")) as Beats;
  const src = existsSync(b.video) ? b.video : join(VID, "innetwork-demo-silent.webm");
  if (!existsSync(src)) throw new Error(`recording ${src} missing`);
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const audit = auditNumber();
  if (!audit && !DRAFT) throw new Error("no docs/AUDIT-*.json with summary.records/age_policy_published - run npm run audit:directories, or pass --draft");
  const zeroOfN = audit ? `${audit.withAge === 0 ? "0" : audit.withAge} of ${audit.records.toLocaleString("en-US")} public directory records we checked say what age a doctor sees.` : "0 of N public directory records we checked say what age a doctor sees.";
  const cardText = {
    c1: "One family. Three health plans. Three networks.",
    c2: "Today an assistant can book a table or a salon. Matching a doctor to each person's plan and age still takes phone calls.",
    c3: zeroOfN,
    c4: 'The first family to hear "we don\'t see under 3" saves every next family the call.',
    end: "InNetwork — a doctor for each person, in their own plan's network.",
  };
  const png = await renderCards([
    { id: "c1", html: cardHtml([{ text: cardText.c1, size: 72 }]) },
    { id: "c2", html: cardHtml([{ text: cardText.c2, size: 58, weight: 700 }]) },
    { id: "c3", html: cardHtml([{ text: cardText.c3, size: 64 }], audit ? `npm run audit:directories · ${audit.file}` : "number from npm run audit:directories (not run yet)") },
    { id: "c4", html: cardHtml([{ text: cardText.c4, size: 60, weight: 700 }], "office policy learned at a booking · demo data in this video") },
    { id: "end", html: cardHtml([{ text: cardText.end, size: 64 }, { text: "Alexa+ simulated in our web host · Alexa voice: synthetic", size: 30, weight: 400, dim: true }]) },
  ]);

  const beat = (n: number) => b.beats.filter((x) => x.beat === n);
  const span = (ns: number[]) => { const xs = ns.flatMap(beat); if (!xs.length) throw new Error(`beat(s) ${ns} not in beats.json`); return { start: Math.min(...xs.map((x) => x.startMs)), end: Math.max(...xs.map((x) => x.endMs)) }; };
  type Seg = { id: string; kind: "rec"; start: number; end: number; beats: number[] } | { id: string; kind: "card"; png: string; secs: number; text: string };
  const seg: Seg[] = [
    { id: "open", kind: "rec", ...span([2]), beats: [2] },
    { id: "c1", kind: "card", png: png.c1, secs: 3.5, text: cardText.c1 },
    { id: "c2", kind: "card", png: png.c2, secs: 5, text: cardText.c2 },
    { id: "c3", kind: "card", png: png.c3, secs: 4.5, text: cardText.c3 },
    { id: "c4", kind: "card", png: png.c4, secs: 4.5, text: cardText.c4 },
    { id: "scene1", kind: "rec", ...span([3, 4]), beats: [3, 4] },
    { id: "scene2", kind: "rec", ...span([5]), beats: [5] },
    { id: "consent", kind: "rec", ...span([1]), beats: [1] },
    { id: "evidence", kind: "rec", ...span([6]), beats: [6] },
    { id: "end", kind: "card", png: png.end, secs: 4, text: cardText.end },
  ];
  const parts: string[] = [];
  const srt: { a: number; b: number; text: string }[] = [];
  let t = 0;
  for (const s of seg) {
    const f = join(WORK, `seg-${s.id}.mp4`);
    if (s.kind === "card") {
      run("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-t", String(s.secs), "-i", s.png, "-f", "lavfi", "-t", String(s.secs), "-i", "anullsrc=r=48000:cl=stereo", "-vf", "scale=1920:1080,format=yuv420p", "-r", "30", "-c:v", "libx264", "-crf", "18", "-c:a", "aac", "-shortest", f]);
      if (s.id === "c1") srt.push({ a: t, b: t + 17_000, text: "Nadya (her own voice, recorded Fri 16.10): I'm a mom of two. One call to book my son's orthopedist took an hour. I've been putting off six doctors for months." });
      srt.push({ a: t, b: t + s.secs * 1000 - 50, text: s.text });
    } else {
      const ss = (s.start / 1000).toFixed(3), to = (s.end / 1000).toFixed(3);
      run("ffmpeg", ["-y", "-loglevel", "error", "-ss", ss, "-to", to, "-i", src, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x14181E,format=yuv420p", "-r", "30", "-c:v", "libx264", "-crf", "18", "-c:a", "aac", "-shortest", f]);
      for (const c of b.cues.filter((x) => s.beats.includes(x.beat) && x.atMs >= s.start && x.atMs < s.end)) {
        const at = t + (c.atMs - s.start);
        srt.push({ a: at, b: at + Math.max(1800, Math.min(9000, c.text.split(/\s+/).length * 400 + 800)), text: `${c.who === "mom" ? "Mom" : "Alexa (synthetic)"}: ${c.text}` });
      }
    }
    parts.push(f);
    t += dur(f) * 1000;
  }
  const list = join(WORK, "list.txt");
  writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
  const out = join(VID, "innetwork-rough-cut.mp4");
  run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out]);
  const total = dur(out);
  srt.sort((x, y) => x.a - y.a);
  writeFileSync(join(VID, "innetwork-rough-cut.srt"), srt.map((c, i) => `${i + 1}\n${srtTime(c.a)} --> ${srtTime(Math.min(c.b, total * 1000))}\n${c.text}\n`).join("\n"));
  const fz = spawnSync("ffmpeg", ["-hide_banner", "-i", out, "-vf", "freezedetect=n=0.001:d=6", "-map", "0:v:0", "-f", "null", "-"], { encoding: "utf8" });
  const freezes = (fz.stderr.match(/freeze_duration: [\d.]+/g) ?? []).map((x) => Number(x.split(": ")[1]));
  const report = [`rough cut ${new Date().toISOString()}${DRAFT ? " (DRAFT)" : ""}`, `duration ${total.toFixed(1)} s (limit 180, target ≤ 170)`, `segments: ${seg.map((s) => s.id).join(" > ")}`, `freezes ≥ 6 s: ${freezes.length ? freezes.map((x) => x.toFixed(1)).join(", ") : "none"}`, `audit card: ${audit ? `${audit.withAge} of ${audit.records} (${audit.file})` : "placeholder N (DRAFT)"}`];
  writeFileSync(join(VID, "innetwork-rough-cut.report.txt"), report.join("\n") + "\n");
  console.log(report.join("\n"));
  console.log(`-> ${out}\n-> ${join(VID, "innetwork-rough-cut.srt")}`);
  if (total > 180) process.exit(2);
}

await main();

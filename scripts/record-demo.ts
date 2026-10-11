// npm run record — silent screen capture of "Play demo" for the video edit (1920x1080: the Echo Show 8 simulator with
// its subtitle bar and the developer view). Needs `npm run demo` running. Writes to docs/video/:
//   innetwork-demo-silent.webm (+ .mp4 if ffmpeg exists)      the capture (binaries are git-ignored)
//   innetwork-demo-alexa-lines.srt                           Alexa's lines (each speech part separately) with times
//   innetwork-demo-beats.json                                { video, durationMs, beats[{beat,label,startMs,endMs}],
//                                                              cues[{atMs, who: "mom"|"alexa", text, beat}] }
// Times are from the start of the capture. Subtitles are not burned in: the host's subtitle bar is in the frame.
//   node scripts/record-demo.ts [--host http://127.0.0.1:5188/] [--theme light]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "video");
const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const host = arg("--host", `http://127.0.0.1:${process.env.HOST_PORT ?? 5188}/`);
const theme = arg("--theme", "dark");
mkdirSync(OUT, { recursive: true });
const tmp = join(OUT, ".rec-tmp");
rmSync(tmp, { recursive: true, force: true });

try { await fetch(`${host}healthz`); } catch { console.error(`host not reachable at ${host} - start it with "npm run demo"`); process.exit(1); }

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: theme === "light" ? "light" : "dark", recordVideo: { dir: tmp, size: { width: 1920, height: 1080 } } });
const page = await context.newPage();
const t0 = Date.now(); // the capture starts with the page
const cues: { atMs: number; who: "mom" | "alexa"; text: string; beat: number }[] = [];
const beats: { beat: number; label: string; startMs: number; endMs: number }[] = [];
await page.exposeFunction("__cue", (c: { who: "mom" | "alexa"; text: string; beat: number }) => { cues.push({ atMs: Date.now() - t0, who: c.who, text: c.text, beat: c.beat }); });
await page.exposeFunction("__beatMark", (b: { beat: number; label: string }) => {
  const at = Date.now() - t0;
  const prev = beats.at(-1);
  if (prev && prev.endMs < 0) prev.endMs = at;
  beats.push({ beat: b.beat, label: b.label, startMs: at, endMs: -1 });
});
await page.goto(`${host}?theme=${theme}`, { waitUntil: "load" });
await page.waitForSelector("body[data-connected]", { timeout: 30_000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);
await page.click("#play-demo");
await page.waitForFunction(() => ["done", "failed"].includes(document.body.dataset.demo ?? ""), undefined, { timeout: 15 * 60_000, polling: 250 });
const doneAt = Date.now() - t0;
const status = await page.evaluate(() => document.body.dataset.demo);
const last = beats.at(-1);
if (last && last.endMs < 0) last.endMs = doneAt;
await page.waitForTimeout(2000);
const video = page.video();
await context.close();
await browser.close();

const webm = join(OUT, "innetwork-demo-silent.webm");
const mp4 = join(OUT, "innetwork-demo-silent.mp4");
if (video) renameSync(await video.path(), webm);
rmSync(tmp, { recursive: true, force: true });

const srtTime = (ms: number) => {
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(r).padStart(3, "0")}`;
};
const alexa = cues.filter((c) => c.who === "alexa");
const srt = alexa.map((c, i) => {
  const end = i + 1 < alexa.length ? alexa[i + 1].atMs - 100 : c.atMs + 6000;
  return `${i + 1}\n${srtTime(c.atMs)} --> ${srtTime(Math.max(end, c.atMs + 1500))}\nAlexa (simulated): ${c.text}\n`;
}).join("\n");
writeFileSync(join(OUT, "innetwork-demo-alexa-lines.srt"), srt);

let ffOk = false, ffErr = "ffmpeg not found";
if (existsSync(webm)) {
  const ff = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-r", "30", mp4], { encoding: "utf8" });
  ffOk = ff.status === 0; ffErr = ff.error ? String(ff.error) : ff.stderr;
}
const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", existsSync(mp4) && ffOk ? mp4 : webm], { encoding: "utf8" });
const durationMs = Math.round(Number(probe.stdout.trim()) * 1000) || doneAt + 2000;
const rel = (p: string) => p.replace(`${ROOT}/`, "");
writeFileSync(join(OUT, "innetwork-demo-beats.json"), JSON.stringify({ video: rel(ffOk ? mp4 : webm), webm: rel(webm), mp4: ffOk ? rel(mp4) : null, durationMs, theme, demo: status, beats, cues }, null, 2) + "\n");
console.log(`demo=${status} beats=${beats.length} cues=${cues.length} (alexa ${alexa.length}) duration=${(durationMs / 1000).toFixed(1)}s`);
console.log(`  ${rel(webm)}`);
console.log(`  ${ffOk ? rel(mp4) : `mp4 not written: ${ffErr.trim().slice(0, 200)}`}`);
console.log(`  ${rel(join(OUT, "innetwork-demo-alexa-lines.srt"))}`);
console.log(`  ${rel(join(OUT, "innetwork-demo-beats.json"))}`);
process.exit(status === "done" ? 0 : 1);

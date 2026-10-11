// npm run tts — Alexa's video lines as synthetic speech (labelled "Alexa voice: synthetic" in the video), one file per
// line, with measured durations against the voice budget (SPEC §2: ≤ 20 s per reply, 2.5 words/s planning rate).
// macOS `say` (voice from TTS_VOICE, default Samantha) -> AIFF -> AAC .m4a in docs/video/tts/ (not in git).
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VIDEO_ALEXA_LINES } from "../verify/protocol.ts";
import { words } from "../src/core/lint.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "video", "tts");
const voice = process.env.TTS_VOICE ?? "Samantha";
const rate = process.env.TTS_RATE ?? "175"; // words per minute for `say`
mkdirSync(OUT, { recursive: true });
const rows: { n: number; words: number; seconds: number; file: string; text: string }[] = [];
VIDEO_ALEXA_LINES.forEach((text, i) => {
  const aiff = join(OUT, `alexa-${String(i + 1).padStart(2, "0")}.aiff`);
  const m4a = aiff.replace(/\.aiff$/, ".m4a");
  const s = spawnSync("say", ["-v", voice, "-r", rate, "-o", aiff, text.replace(/ — /g, ", ")], { encoding: "utf8" });
  if (s.status !== 0) throw new Error(`say failed: ${s.stderr}`);
  spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-c:a", "aac", "-b:a", "128k", m4a]);
  const d = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", m4a], { encoding: "utf8" }).stdout.trim());
  rows.push({ n: i + 1, words: words(text), seconds: Math.round(d * 10) / 10, file: m4a, text });
});
const total = rows.reduce((a, r) => a + r.seconds, 0);
const report = [`voice=${voice} rate=${rate} wpm`, ...rows.map((r) => `${r.n}. ${r.words} words · ${r.seconds} s · ${(r.words / r.seconds).toFixed(2)} w/s :: ${r.text.slice(0, 60)}`), `total ${rows.reduce((a, r) => a + r.words, 0)} words · ${total.toFixed(1)} s · longest ${Math.max(...rows.map((r) => r.seconds))} s`];
writeFileSync(join(OUT, "durations.txt"), report.join("\n") + "\n");
console.log(report.join("\n"));
process.exit(Math.max(...rows.map((r) => r.seconds)) > 20 ? 1 : 0);

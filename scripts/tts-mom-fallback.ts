// npm run tts:mom — FALLBACK only: the mom's lines and the intro as synthetic speech, used in the video only if the
// author's own recording (Fri 16.10) does not happen, and then labelled "Voice: synthetic (not the author)".
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "video", "tts");
const voice = process.env.TTS_MOM_VOICE ?? "Flo (English (US))";
export const MOM_LINES = [
  { id: "intro", text: "I'm a mom of two. One call to book my son's orthopedist took an hour. I've been putting off six doctors for months." },
  { id: "opening", text: "Alexa, I need a gastroenterologist, an allergist for my five-year-old, and an orthopedist for my little one. He's under two." },
  { id: "yes", text: "Yes." },
  { id: "checkup", text: "Alexa, I've met my out-of-pocket max this year. I want a full checkup: primary care, OB-GYN, a dermatologist, a gastroenterologist and lab work. Book them all before my plan resets." },
  { id: "whats-left", text: "Alexa, what's left on my checkup plan?" },
  { id: "ortho", text: "Alexa, find an orthopedist for my youngest. He's under two." },
  { id: "allow", text: "Allow." },
];
mkdirSync(OUT, { recursive: true });
const lines: string[] = [`FALLBACK voice=${voice} (label in video: "Voice: synthetic (not the author)")`];
for (const l of MOM_LINES) {
  const aiff = join(OUT, `mom-${l.id}.aiff`), m4a = aiff.replace(/\.aiff$/, ".m4a");
  const s = spawnSync("say", ["-v", voice, "-r", "165", "-o", aiff, l.text], { encoding: "utf8" });
  if (s.status !== 0) throw new Error(`say failed: ${s.stderr}`);
  spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-c:a", "aac", "-b:a", "128k", m4a]);
  const d = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", m4a], { encoding: "utf8" }).stdout.trim();
  lines.push(`${l.id}: ${Number(d).toFixed(1)} s`);
}
writeFileSync(join(OUT, "mom-durations.txt"), lines.join("\n") + "\n");
console.log(lines.join("\n"));

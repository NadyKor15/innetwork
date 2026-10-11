// npm run directory:warm [-- --zip 32801] [--plans plan-a,plan-c] [--specialties dermatology,...]
// Fetches the live answers the demo needs and writes them to data/cache (gitignored), so live mode answers a voice
// turn in milliseconds. Plan B streams the issuer's marketplace files (≈3 GB, about a minute); Plan C asks Molina one
// location at a time (tens of seconds). Prints one line per answer and the error count; exit 1 if nothing answered.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CACHE_DIR, liveLookup, writeCache } from "../src/directory/index.ts";
import { PLANS } from "../src/directory/plans.ts";
import type { Specialty } from "../src/core/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const scenarioZip = (() => { try { return (JSON.parse(readFileSync(join(ROOT, "fixtures", "demo", "scenario.json"), "utf8")) as { zip?: string }).zip; } catch { return undefined; } })();
const zip = arg("zip") ?? process.env.DEMO_ZIP ?? scenarioZip ?? "32801";
const cacheDir = process.env.DIRECTORY_CACHE_DIR ?? DEFAULT_CACHE_DIR;
const timeoutMs = Number(process.env.DIRECTORY_TIMEOUT_MS ?? 15000);

const DEMO: Record<string, Specialty[]> = {
  "plan-a": ["primary_care", "ob_gyn", "gastroenterology", "dermatology"],
  "plan-b": ["allergy"],
  "plan-c": ["orthopedics"],
};
const plans = (arg("plans")?.split(",") ?? Object.keys(DEMO)).map((id) => PLANS.find((p) => p.planId === id)).filter((p) => p !== undefined);
const onlySpecs = arg("specialties")?.split(",") as Specialty[] | undefined;

let okCount = 0, failCount = 0;
const t0 = Date.now();
console.log(`directory:warm · ZIP ${zip} · cache ${cacheDir} · timeout ${timeoutMs} ms · ${new Date().toISOString()}`);
for (const plan of plans) {
  for (const specialty of onlySpecs ?? DEMO[plan.planId]) {
    const a = await liveLookup(plan, specialty, zip, { timeoutMs, molinaDeadlineMs: 600_000, allowFileStream: true });
    if (a.ok) {
      okCount++;
      writeCache(cacheDir, plan.planId, specialty, zip, a);
      console.log(`  ok   ${plan.label} ${plan.planId.padEnd(6)} ${specialty.padEnd(16)} ${String(a.records.length).padStart(4)} records · ${String(a.inNetworkCount ?? "-").padStart(4)} in network · ${a.ms} ms · ${a.mode} · ${a.directory}`);
    } else {
      failCount++;
      console.log(`  FAIL ${plan.label} ${plan.planId.padEnd(6)} ${specialty.padEnd(16)} ${a.error} · ${a.ms} ms`);
    }
  }
}
console.log(`answered ${okCount} · failed ${failCount} · ${Math.round((Date.now() - t0) / 1000)} s`);
if (okCount === 0) process.exitCode = 1;

// npm run guard:names — every fictional doctor name we show must belong to nobody real (SPEC §4.4).
//
// Collects names from fixtures/directory (practitioner names in the recorded samples), fixtures/demo/*.json (the
// scenario) and design/ (screen briefs, mockup HTML), then for each "First Last":
//   1. NPPES first_name+last_name, state=FL      -> must be 0
//   2. NPPES first_name+last_name, any state     -> must be 0
//   3. NPPES last_name alone, state=FL           -> must be 0
//   4. the pool of live directory answers we hold (data/cache, audit-private/captures, audit-private/pool) -> 0
// Fictional office names in the samples are checked against NPPES organization_name (state=FL, exact) -> 0.
// Must-light controls printed next to the result: "Maria Garcia" in NPPES FL (> 0), a known organization name (> 0),
// and a synthetic name planted in the pool (found). Network errors are counted; any error, any match or a dark
// control -> exit 1 (a check that could not look is not a pass).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Counters } from "../packages/plannet-directory-check/src/http.ts";
import { nppesSearch } from "../packages/plannet-directory-check/src/nppes.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const counters = new Counters();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function walk(dir: string, exts: RegExp, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) { if (f !== "node_modules" && f !== "fonts" && f !== "shots") walk(p, exts, out); }
    else if (exts.test(f) && st.size < 5_000_000) out.push(p);
  }
  return out;
}

type Found = { name: string; first: string; last: string; where: Set<string> };
const names = new Map<string, Found>();
const add = (first: string, last: string, where: string) => {
  const f = first.trim(), l = last.trim();
  if (!/^[A-Z][a-z]+$/.test(f) || !/^[A-Z][a-zA-Z'-]+$/.test(l)) return;
  const key = `${f} ${l}`;
  if (!names.has(key)) names.set(key, { name: key, first: f, last: l, where: new Set() });
  names.get(key)!.where.add(where);
};
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

// 1. recorded samples: structured names
const offices = new Map<string, Set<string>>();
for (const f of walk(join(ROOT, "fixtures", "directory"), /\.json$/).filter((x) => !x.endsWith(".meta.json"))) {
  const rel = relative(ROOT, f);
  const body = JSON.parse(readFileSync(f, "utf8"));
  const visit = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(visit); return; }
    const o = v as Record<string, any>;
    if (o.resourceType === "Practitioner") for (const n of o.name ?? []) if (n.given?.[0] && n.family) add(title(n.given[0]), title(n.family), rel);
    if (o.practitioner?.display) { const [a, ...b] = String(o.practitioner.display).split(" "); add(a, b[b.length - 1] ?? "", rel); }
    if (o.type === "INDIVIDUAL" && o.name?.first && o.name?.last) add(o.name.first, o.name.last, rel);
    if (o.resourceType === "Location" && typeof o.name === "string" && /[a-z]/.test(o.name)) { if (!offices.has(o.name)) offices.set(o.name, new Set()); offices.get(o.name)!.add(rel); }
    for (const k of Object.keys(o)) visit(o[k]);
  };
  visit(body);
}
// Office names the capture script invented (also used where the directory names a Location by its street).
const cap = join(ROOT, "scripts", "fixtures-capture.ts");
if (existsSync(cap)) for (const m of readFileSync(cap, "utf8").matchAll(/name: "([^"]+)", line: "/g)) { if (!offices.has(m[1])) offices.set(m[1], new Set()); offices.get(m[1])!.add("scripts/fixtures-capture.ts"); }

// 2. scenario + design: "Dr. First Last" anywhere in text
const DR = /\bDr\.\s+([A-Z][a-z]+)\s+([A-Z][a-zA-Z'-]+)/g;
for (const f of [...walk(join(ROOT, "fixtures", "demo"), /\.json$/), ...walk(join(ROOT, "design"), /\.(txt|md|html|json|svg)$/), ...walk(join(ROOT, "scripts"), /^demo\.ts$/)]) {
  const rel = relative(ROOT, f);
  for (const m of readFileSync(f, "utf8").matchAll(DR)) add(m[1], m[2], rel);
}

// 3. the pool of live answers (real names) — only read locally, never printed
const pool = new Set<string>();
const poolSurnames = new Set<string>();
const poolAdd = (full: string | null | undefined) => {
  if (!full) return;
  const clean = full.replace(/^Dr\.\s+/i, "").replace(/,?\s+(MD|DO|M\.D\.|D\.O\.)\.?$/i, "").trim().toUpperCase();
  const parts = clean.split(/\s+/);
  if (parts.length < 2) return;
  pool.add(`${parts[0]} ${parts[parts.length - 1]}`);
  poolSurnames.add(parts[parts.length - 1]);
};
const poolFiles = [...walk(join(ROOT, "data", "cache"), /\.json$/), ...walk(join(ROOT, "audit-private"), /\.json$/)];
for (const f of poolFiles) {
  try {
    const body = JSON.parse(readFileSync(f, "utf8"));
    const visit = (v: unknown) => {
      if (!v || typeof v !== "object") return;
      if (Array.isArray(v)) { v.forEach(visit); return; }
      const o = v as Record<string, any>;
      if (typeof o.name === "string" && o.source?.mode === "live") poolAdd(o.name);
      if (o.resourceType === "Practitioner") for (const n of o.name ?? []) poolAdd(n.text ?? [...(n.given ?? []), n.family].join(" "));
      if (o.practitioner?.display) poolAdd(o.practitioner.display);
      if (o.type === "INDIVIDUAL" && o.name?.first) poolAdd(`${o.name.first} ${o.name.last}`);
      if (Array.isArray(o.poolNames)) o.poolNames.forEach((x: string) => poolAdd(x));
      for (const k of Object.keys(o)) visit(o[k]);
    };
    visit(body);
  } catch { /* not JSON we understand */ }
}
const PLANTED = "Zzplanted Zzcontrol";
pool.add(PLANTED.toUpperCase());
const poolControl = pool.has(PLANTED.toUpperCase());

async function nppesCount(q: Record<string, string>): Promise<number | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await nppesSearch({ ...q, limit: 200 } as never, { counters, timeoutMs: 20_000 });
      return r.count;
    } catch {
      await sleep(800 * (attempt + 1));
    }
  }
  return null;
}

console.log(`guard:names · ${new Date().toISOString()} · ${names.size} fictional names · ${offices.size} fictional office names · pool of live answers: ${pool.size - 1} names from ${poolFiles.length} files`);
const control = await nppesCount({ first_name: "Maria", last_name: "Garcia", state: "FL" });
const orgControl = await nppesCount({ organization_name: "ADVENTIST HEALTH SYSTEM/SUNBELT INC.", state: "FL" });
let matches = 0;
let unknown = 0;
for (const n of [...names.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const fl = await nppesCount({ first_name: n.first, last_name: n.last, state: "FL" });
  const us = await nppesCount({ first_name: n.first, last_name: n.last });
  const sur = await nppesCount({ last_name: n.last, state: "FL" });
  const inPool = pool.has(`${n.first} ${n.last}`.toUpperCase());
  const surInPool = poolSurnames.has(n.last.toUpperCase());
  const bad = (fl ?? 1) > 0 || (us ?? 1) > 0 || (sur ?? 1) > 0 || inPool;
  if ([fl, us, sur].includes(null)) unknown++;
  if (bad) matches++;
  console.log(`  ${bad ? "MATCH" : "ok   "} ${n.name.padEnd(24)} NPPES FL ${fl ?? "?"} · US ${us ?? "?"} · surname FL ${sur ?? "?"} · pool ${inPool ? "yes" : "0"}${surInPool ? " (surname in pool)" : ""} · ${[...n.where].join(", ")}`);
}
for (const [o, where] of [...offices.entries()].sort()) {
  const c = await nppesCount({ organization_name: o.toUpperCase(), state: "FL" });
  if (c === null) unknown++;
  if ((c ?? 1) > 0) matches++;
  console.log(`  ${(c ?? 1) > 0 ? "MATCH" : "ok   "} office "${o}" NPPES organization FL ${c ?? "?"} · ${[...where].join(", ")}`);
}
console.log(`control: "Maria Garcia" NPPES FL = ${control ?? "?"} (must be > 0) · organization control = ${orgControl ?? "?"} (must be > 0) · planted pool name found = ${poolControl}`);
console.log(`network: ${counters.summary()}`);
const controlsLit = (control ?? 0) > 0 && (orgControl ?? 0) > 0 && poolControl;
if (matches > 0 || unknown > 0 || !controlsLit || names.size === 0) {
  console.log(`FAIL: matches ${matches} · unanswered checks ${unknown} · controls lit ${controlsLit} · names ${names.size}`);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${names.size} names and ${offices.size} offices, 0 matches, controls lit`);
}

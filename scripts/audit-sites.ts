// npm run audit:sites — does the practice's OWN website say which patient ages it sees, when the insurer directory
// says nothing? (SPEC §5.1, second measurement.)
//
//   node scripts/audit-sites.ts --candidates [--zips 32803,32806,32801] [--specialty orthopedics] [--n 30]
//       In-network Plan A practitioners from the live Florida Blue directory (BlueChoice), one per NPI, with what
//       their directory records say about age -> audit-private/sites-candidates.json (real names: local only).
//   node scripts/audit-sites.ts [--input audit-private/sites-input.json]
//       Input rows { id, npi, url, source } (url = the practice's own page for that practitioner; found in the
//       directory's telecom where present, otherwise by a manual web search, recorded in `source`).
//       For each URL: robots.txt honoured, one GET of a public page, no forms, no calls. Parses the visible text for
//       patient-age wording (src/directory/site-age.ts). Writes per-site rows to audit-private/ and ONLY the aggregate
//       to docs/AUDIT-SITES-<date>.md. Prints the parser's must-light control and the count of sites that did not open.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FhirClient } from "../packages/plannet-directory-check/src/fhir.ts";
import { Counters } from "../packages/plannet-directory-check/src/http.ts";
import { agePolicyPublished } from "../packages/plannet-directory-check/src/plannet.ts";
import { rolesInZip } from "../packages/plannet-directory-check/src/records.ts";
import { nppesSearch, practiceAddresses } from "../packages/plannet-directory-check/src/nppes.ts";
import { FB } from "../src/directory/florida-blue.ts";
import { FLORIDA_BLUE_PLAN_ID_SYSTEM, PLAN_SOURCES } from "../src/directory/plans.ts";
import { isSpecialty, SPECIALTY_TAXONOMY } from "../src/directory/specialties.ts";
import { minimumAgeStated, siteAgeStatements, visibleText, type SiteAge } from "../src/directory/site-age.ts";
import type { Specialty } from "../src/core/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE = join(ROOT, "audit-private");
const argv = process.argv.slice(2);
const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const UA = "innetwork-site-audit/0.1 (read-only; one GET per public page; honours robots.txt)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- candidates ------------------------------------------------------------------------------------------------------
async function candidates() {
  const zips = (arg("zips") ?? "32803,32806,32801").split(",");
  const specialty = (arg("specialty") ?? "orthopedics") as Specialty;
  const n = Number(arg("n") ?? 30);
  const src = PLAN_SOURCES["plan-a"];
  if (src.kind !== "fhir-plannet" || src.directory !== "florida-blue") throw new Error("plan-a source");
  const counters = new Counters();
  const client = new FhirClient(FB.base, { timeoutMs: 30_000, counters, maxPages: 15 });
  const byNpi = new Map<string, { npi: string; name: string | null; specialty: string; zip: string; address: string; phone: string | null; directoryAgeStated: boolean; directoryRecords: number; urls: string[] }>();
  for (const zip of zips) {
    for (const text of (FB.specialtySearch?.[specialty] ?? [])) {
      const res = await rolesInZip(FB, client, { zip, identifier: `${FLORIDA_BLUE_PLAN_ID_SYSTEM}|${src.planCode}`, specialtyText: text, keepRaw: true });
      for (const r of res.roles) {
        if (!r.npi || !isSpecialty(specialty, r.specialtyCodes, r.specialtyTexts) || !r.location) continue;
        const raw = [r.raw?.role, r.raw?.location].filter((x) => x) as never[];
        const ageStated = raw.some((x) => agePolicyPublished(x).published);
        const telecom = ((r.raw?.role as { telecom?: { system?: string; value?: string }[] })?.telecom ?? []);
        const urls = telecom.filter((t) => t.system === "url").map((t) => t.value ?? "");
        const prev = byNpi.get(r.npi);
        if (prev) { prev.directoryRecords++; prev.directoryAgeStated ||= ageStated; continue; }
        byNpi.set(r.npi, { npi: r.npi, name: r.name, specialty: SPECIALTY_TAXONOMY[specialty].label, zip, address: `${r.location.line}, ${r.location.city} ${r.location.zip}`, phone: telecom.find((t) => t.system === "phone")?.value ?? null, directoryAgeStated: ageStated, directoryRecords: 1, urls });
      }
    }
  }
  // Spread over practices: round-robin by address (many roles share one big campus address), then by NPI.
  const byAddr = new Map<string, (typeof byNpi extends Map<string, infer V> ? V : never)[]>();
  for (const c of [...byNpi.values()].sort((a, b) => zips.indexOf(a.zip) - zips.indexOf(b.zip) || a.npi.localeCompare(b.npi))) {
    if (!byAddr.has(c.address)) byAddr.set(c.address, []);
    byAddr.get(c.address)!.push(c);
  }
  const list: (typeof byNpi extends Map<string, infer V> ? V : never)[] = [];
  for (let i = 0; list.length < n && [...byAddr.values()].some((v) => v.length > i); i++) for (const v of byAddr.values()) if (v[i] && list.length < n) list.push(v[i]);
  console.log(`addresses: ${byAddr.size} distinct among ${byNpi.size} practitioners`);
  // NPPES practice address per NPI (self-reported to CMS): does the practitioner practice where the directory says?
  for (const c of list as (typeof list[number] & { nppes?: unknown })[]) {
    try {
      const { results } = await nppesSearch({ number: c.npi }, { counters, timeoutMs: 20_000 });
      const r = results[0];
      const addrs = r ? practiceAddresses(r) : [];
      c.nppes = r ? { locations: addrs.map((a) => ({ city: a.city ?? "", state: a.state ?? "", zip: (a.postal_code ?? "").slice(0, 5) })), lastUpdated: r.basic.last_updated ?? null } : null;
    } catch (err) { c.nppes = { error: (err as Error).message.slice(0, 80) }; }
  }
  mkdirSync(PRIVATE, { recursive: true });
  writeFileSync(join(PRIVATE, "sites-candidates.json"), JSON.stringify({ capturedAt: new Date().toISOString(), plan: "plan-a (Florida Blue BlueChoice, network PPC-2026-BCHPPO)", specialty, zips, candidates: list }, null, 1));
  console.log(`${byNpi.size} in-network ${specialty} practitioners (distinct NPI) in ${zips.join(", ")} · kept ${list.length} · with a URL in the directory: ${list.filter((c) => c.urls.length).length} · directory states an age for ${list.filter((c) => c.directoryAgeStated).length} · ${counters.summary()}`);
  console.log(`wrote audit-private/sites-candidates.json (local only)`);
}

// ---- robots.txt ------------------------------------------------------------------------------------------------------
type Robots = { allow: string[]; disallow: string[] } | "unavailable";
const robotsCache = new Map<string, Robots>();
const robotsStatus = new Map<string, string>();
async function robotsFor(origin: string): Promise<Robots> {
  if (robotsCache.has(origin)) return robotsCache.get(origin)!;
  let result: Robots;
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000), redirect: "follow" });
    robotsStatus.set(origin, String(res.status));
    if (res.status === 404 || res.status === 410) result = { allow: [], disallow: [] };
    else if (!res.ok) result = "unavailable";
    else result = parseRobots(await res.text());
  } catch (err) {
    robotsStatus.set(origin, (err as Error).name);
    result = "unavailable";
  }
  robotsCache.set(origin, result);
  return result;
}
/** Rules of the group for our user agent if any, else the `*` group (RFC 9309). */
export function parseRobots(txt: string): { allow: string[]; disallow: string[] } {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], allow: [], disallow: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" && val) cur.allow.push(val);
    if (key === "disallow" && val) cur.disallow.push(val);
  }
  const ours = groups.find((g) => g.agents.some((a) => a !== "*" && "innetwork-site-audit".startsWith(a)));
  const star = groups.filter((g) => g.agents.includes("*"));
  const g = ours ?? { allow: star.flatMap((x) => x.allow), disallow: star.flatMap((x) => x.disallow) };
  return { allow: g.allow, disallow: g.disallow };
}
export function robotsAllows(rules: { allow: string[]; disallow: string[] }, path: string): boolean {
  const match = (pat: string) => {
    const re = new RegExp(`^${pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")}`);
    return re.test(path) ? pat.length : -1;
  };
  const a = Math.max(-1, ...rules.allow.map(match));
  const d = Math.max(-1, ...rules.disallow.map(match));
  return d < 0 || a >= d;
}

// ---- site sweep ------------------------------------------------------------------------------------------------------
type Row = { id: string; npi?: string; url: string | null; source: string; note?: "no_own_page_found" | "practices_elsewhere" };
type Outcome = { id: string; host: string; status: "ok" | "robots_disallowed" | "robots_unavailable" | "did_not_open" | "no_own_page_found" | "practices_elsewhere"; http: number | null; statements: SiteAge[]; minAge: number | null; ms: number; error?: string; textChars?: number };

const o_or = (robots: string | undefined, page: (number | null)[]) => [robots && robots !== "200" ? `robots.txt ${robots}` : null, page.length ? `page ${[...new Set(page)].join("/")}` : null].filter(Boolean).join(", ");

async function sweep() {
  const input = arg("input") ?? join(PRIVATE, "sites-input.json");
  if (!existsSync(input)) { console.error(`no input: ${input} (build it from audit-private/sites-candidates.json)`); process.exit(2); }
  const parsed = JSON.parse(readFileSync(input, "utf8")) as { rows: Row[] } | Row[];
  const rows: Row[] = Array.isArray(parsed) ? parsed : parsed.rows;
  const cand = existsSync(join(PRIVATE, "sites-candidates.json")) ? (JSON.parse(readFileSync(join(PRIVATE, "sites-candidates.json"), "utf8")) as { candidates: { npi: string; directoryAgeStated: boolean }[] }).candidates : [];
  // Must-light control of the parser, on synthetic pages, in this run.
  const lit = minimumAgeStated(siteAgeStatements("<p>We see patients ages 3 and older.</p>")) === 3;
  const dark = siteAgeStatements("<p>Board-certified orthopaedic surgeon, 18 years in practice.</p>").length === 0;
  const lastHit = new Map<string, number>();
  const out: Outcome[] = [];
  for (const row of rows) {
    const t0 = Date.now();
    if (!row.url) { out.push({ id: row.id, host: "-", status: row.note ?? "no_own_page_found", http: null, statements: [], minAge: null, ms: 0 }); continue; }
    let u: URL;
    try { u = new URL(row.url); } catch { out.push({ id: row.id, host: "-", status: "did_not_open", http: null, statements: [], minAge: null, ms: 0, error: "bad url" }); continue; }
    const wait = (lastHit.get(u.host) ?? 0) + 2000 - Date.now();
    if (wait > 0) await sleep(wait);
    const robots = await robotsFor(u.origin);
    if (robots === "unavailable") { out.push({ id: row.id, host: u.host, status: "robots_unavailable", http: null, statements: [], minAge: null, ms: Date.now() - t0 }); continue; }
    if (!robotsAllows(robots, u.pathname + u.search)) { out.push({ id: row.id, host: u.host, status: "robots_disallowed", http: null, statements: [], minAge: null, ms: Date.now() - t0 }); continue; }
    try {
      lastHit.set(u.host, Date.now());
      const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(20_000), redirect: "follow" });
      const body = (await res.text()).slice(0, 3_000_000);
      if (!res.ok) { out.push({ id: row.id, host: u.host, status: "did_not_open", http: res.status, statements: [], minAge: null, ms: Date.now() - t0 }); continue; }
      const st = siteAgeStatements(body);
      out.push({ id: row.id, host: u.host, status: "ok", http: res.status, statements: st, minAge: minimumAgeStated(st), ms: Date.now() - t0, textChars: visibleText(body).length });
    } catch (err) {
      out.push({ id: row.id, host: u.host, status: "did_not_open", http: null, statements: [], minAge: null, ms: Date.now() - t0, error: (err as Error).message.slice(0, 120) });
    }
    const o = out[out.length - 1];
    console.log(`  ${o.status.padEnd(18)} ${String(o.http ?? "-").padEnd(4)} ${o.minAge === null ? "no age statement" : `youngest stated ${o.minAge}`} · ${o.statements.map((s) => s.kind).join(", ") || "-"}`);
  }
  const opened = out.filter((o) => o.status === "ok");
  const statesMin = opened.filter((o) => o.statements.some((s) => (s.kind === "min_age" && s.minYears > 0) || (s.kind === "range" && s.minYears > 0) || s.kind === "adults_only"));
  const statesAny = opened.filter((o) => o.statements.length > 0);
  const withUrl = out.filter((o) => o.status !== "no_own_page_found" && o.status !== "practices_elsewhere");
  const failed = withUrl.filter((o) => o.status !== "ok");
  const noPage = out.filter((o) => o.status === "no_own_page_found");
  const elsewhere = out.filter((o) => o.status === "practices_elsewhere");
  const dirKnown = rows.filter((r) => cand.some((x) => x.npi === r.npi));
  const dirNothing = dirKnown.length === rows.length && dirKnown.every((r) => !cand.find((x) => x.npi === r.npi)!.directoryAgeStated);
  const nppesOutOfState = rows.filter((r) => { const c = cand.find((x) => x.npi === r.npi) as { nppes?: { locations?: { state: string }[] } } | undefined; const locs = c?.nppes?.locations ?? []; return locs.length > 0 && !locs.some((l) => l.state === "FL"); }).length;
  const nppesKnown = rows.filter((r) => ((cand.find((x) => x.npi === r.npi) as { nppes?: { locations?: unknown[] } } | undefined)?.nppes?.locations ?? []).length > 0).length;
  const day = new Date().toISOString().slice(0, 10);
  writeFileSync(join(PRIVATE, `sites-results-${day}.json`), JSON.stringify({ at: new Date().toISOString(), rows: out }, null, 1));
  const candMeta = existsSync(join(PRIVATE, "sites-candidates.json")) ? JSON.parse(readFileSync(join(PRIVATE, "sites-candidates.json"), "utf8")) as { specialty?: string; zips?: string[] } : {};
  const sentence = `${statesMin.length} of ${opened.length} practice pages that opened state a minimum patient age (${statesAny.length} of ${opened.length} say anything about ages); ${dirNothing ? `the insurer directory says nothing about age for all ${rows.length} practitioners` : `directory age data known for ${dirKnown.length} of ${rows.length}`}`;
  const md = [
    `# Practice websites vs the insurer directory — ${day}`,
    "",
    `- Run: ${new Date().toISOString()} · command: \`npm run audit:sites\` (input: ${rows.length} practitioners, local file, not published)`,
    `- Practitioners: in-network for Plan A (Florida Blue BlueChoice, network PPC-2026-BCHPPO), ${candMeta.specialty ?? "?"}, directory locations in ZIPs ${(candMeta.zips ?? []).join(", ")}, spread over the directory's practice addresses (round-robin). The practitioner's own page was looked up by a manual web search (the directory carries no URL: 0 of ${rows.length}); third-party directories were not counted as a practice's own page.`,
    `- Method: robots.txt honoured, one GET per public page, 2 s between requests to a host, no forms, no calls; visible text parsed for patient-age wording (\`src/directory/site-age.ts\`).`,
    `- Parser control (synthetic pages, this run): "ages 3 and older" found = **${lit}**, plain bio page stays quiet = **${dark}**.`,
    `- Pages that did not open: **${failed.length}** of ${withUrl.length} (robots disallowed ${out.filter((o) => o.status === "robots_disallowed").length}, robots.txt unavailable ${out.filter((o) => o.status === "robots_unavailable").length}, HTTP error or timeout ${out.filter((o) => o.status === "did_not_open").length}). Hosts that refused an automated read: ${[...new Set(failed.map((o) => o.host))].map((h) => { const rs = robotsStatus.get(`https://${h}`); const page = failed.filter((o) => o.host === h).map((o) => o.http).filter(Boolean); return `${h} (${o_or(rs, page)})`; }).join(", ") || "none"}. When robots.txt itself is refused we do not read the page.`,
    "",
    `**${sentence}.**`,
    "",
    "| Outcome | Practitioners |",
    "|---|---|",
    `| Own page states a minimum age (e.g. "ages 3 and up", "adults only") | ${statesMin.length} |`,
    `| Own page states all ages / children only / a range from birth | ${statesAny.length - statesMin.length} |`,
    `| Own page opened, no age wording | ${opened.length - statesAny.length} |`,
    `| Own page found but did not open for an automated read | ${failed.length} |`,
    `| No own page found | ${noPage.length} |`,
    `| Current employer profiles found place the practitioner in another state | ${elsewhere.length} |`,
    `| **Total** | **${rows.length}** |`,
    "",
    `NPPES cross-check (practice addresses the practitioner reported to CMS): ${nppesOutOfState} of ${nppesKnown} have no practice address in Florida.`,
    "",
    "Names, addresses and per-site rows are not published; they stay in a local file.",
  ];
  writeFileSync(join(ROOT, "docs", `AUDIT-SITES-${day}.md`), `${md.join("\n")}\n`);
  console.log(sentence);
  console.log(`parser control: lit ${lit} · dark ${dark} · did not open ${failed.length} of ${withUrl.length} with a page · no own page ${noPage.length} · elsewhere ${elsewhere.length} · NPPES out of state ${nppesOutOfState} of ${nppesKnown}`);
  console.log(`wrote docs/AUDIT-SITES-${day}.md (aggregate) and audit-private/sites-results-${day}.json (rows, local)`);
  if (!lit || !dark) process.exitCode = 1;
}

if (argv.includes("--candidates")) await candidates();
else await sweep();

// Mutation checks: each refusal (SPEC §3) is broken on purpose in a throwaway COPY of the repo, and the test that
// guards it must go red. A mutation that leaves the tests green means the gate is not really tested.
// The working tree is never touched. Every mutation must apply exactly once (the replacement count is checked).
//   node verify/mutations.ts            -> table + exit 1 if any mutation survives
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export type Mutation = { id: string; gate: string; file: string; find: string; replace: string; tests: string[]; expectFailing: RegExp };

export const MUTATIONS: Mutation[] = [
  { id: "M-N1", gate: "N1 symptom without a specialty -> fixed answer", file: "src/core/lint.ts", find: "if (!hasSpecialty && SYMPTOM.test(utterance))", replace: "if (false)", tests: ["src/core/core.test.ts"], expectFailing: /N1-symptom-refusal/ },
  { id: "M-N2", gate: "N2 in network only with the plan's network id", file: "src/core/network-gate.ts", find: "else if (record.networks.some((n) => plan.networkIds.includes(n)))", replace: "else if (true)", tests: ["src/core/core.test.ts"], expectFailing: /N2: in network only/ },
  { id: "M-N2b", gate: "N2 out-of-network booking needs a second yes", file: "server/tools.ts", find: "if (oon.length && !book_anyway) {", replace: "if (false) {", tests: ["server/server.test.ts"], expectFailing: /N2: an out-of-network proposal/ },
  { id: "M-N3", gate: "N3 no age data never fits a child's search", file: "src/core/network-gate.ts", find: 'return { status: "age_not_listed", reason: "Age not listed · we\'ll ask the office when booking", source: "directory has no age field" };', replace: 'return { status: "sees_this_age", reason: "sees this age", source: "assumed" };', tests: ["src/core/core.test.ts"], expectFailing: /N3: three age outcomes/ },
  { id: "M-N4", gate: "N4 the age said for a search is never stored", file: "server/tools.ts", find: 's.pending = proposals.length ? { kind: "book", from: "find_in_network", proposals, at: now } : null;', replace: 's.pending = proposals.length ? { kind: "book", from: "find_in_network", proposals, at: now, ageBand: lookups.find((l) => l.ageBand)?.ageBand } as never : null;', tests: ["server/server.test.ts"], expectFailing: /demo story/ },
  { id: "M-N5", gate: "N5 no member ID read aloud", file: "src/core/lint.ts", find: "if (MEMBER_ID.test(text))", replace: "if (false)", tests: ["src/core/core.test.ts"], expectFailing: /N5: no member ID/ },
  { id: "M-N6", gate: "N6 nothing looked up before consent", file: "server/tools.ts", find: "(u.consent?.granted ? null :", replace: "(true ? null :", tests: ["server/server.test.ts"], expectFailing: /N6: nothing is looked up/ },
  { id: "M-N7", gate: "N7 emergencies get the fixed line", file: "src/core/lint.ts", find: "if (EMERGENCY.test(utterance))", replace: "if (false)", tests: ["src/core/core.test.ts"], expectFailing: /N7: emergencies/ },
  { id: "M-N8", gate: "N8 directory did not answer -> not confirmed", file: "src/core/network-gate.ts", find: "if (!directoryAnswered) network =", replace: "if (false) network =", tests: ["src/core/core.test.ts"], expectFailing: /N8: directory did not answer/ },
  { id: "M-N9", gate: "N9 never 'free'; coverage needs 'usually' + source", file: "src/core/lint.ts", find: "if (FREE.test(text))", replace: "if (false)", tests: ["src/core/core.test.ts"], expectFailing: /N9: no 'free'/ },
  { id: "M-N10", gate: "N10 lab work waits for the primary care visit", file: "src/core/checkup.ts", find: 'return pcpDone ? "ready" : "may_need_order";', replace: 'return "ready";', tests: ["server/server.test.ts"], expectFailing: /demo story/ },
  { id: "M-N11", gate: "N11 real directory records never get sandbox slots", file: "server/tools.ts", find: "const slotsOf = (sv: Services, r: DirectoryRecord) => (isSandboxRecord(r) ? sv.scenario.slotsFor(r.name) : []);", replace: "const slotsOf = (sv: Services, r: DirectoryRecord) => sv.scenario.slotsFor(r.name);", tests: ["server/server.test.ts"], expectFailing: /N11: a live directory record/ },
  { id: "M-N12", gate: "N12 no visit over the routine", file: "src/core/schedule.ts", find: "const filter = args.routineFilter ?? true;", replace: "const filter = args.routineFilter ?? false;", tests: ["src/core/core.test.ts"], expectFailing: /N12-routine-overlap/ },
  { id: "M-N12b", gate: "N12 over-routine booking needs an explicit yes", file: "server/tools.ts", find: "if (over.length && !book_over_routine)", replace: "if (false)", tests: ["server/server.test.ts"], expectFailing: /N12: a time over the routine/ },
  { id: "M-N13", gate: "N13 notes never reorder results", file: "server/tools.ts", find: "const ranked = rankDecisions(lk.decisions, lk.records, firstSlot);\n  const existing", replace: "const ranked = rankDecisions(lk.decisions, lk.records, firstSlot);\n  ranked.fits.sort((a, b) => (noteFor(u, lk.records.get(b.recordId)!) ? 1 : 0) - (noteFor(u, lk.records.get(a.recordId)!) ? 1 : 0));\n  const existing", tests: ["server/server.test.ts"], expectFailing: /N13-notes-private/ },
  { id: "M-N13b", gate: "N13 notes never enter office policies", file: "server/store.ts", find: "const clean = Object.fromEntries(POLICY_KEYS.map((k) => [k, p[k]])) as OfficePolicy;", replace: "const clean = { ...p } as OfficePolicy;", tests: ["server/server.test.ts"], expectFailing: /N13: an office policy keeps only its six fields/ },
];

export type MutationRow = { id: string; gate: string; applied: number; killed: boolean; failing: string; ms: number };

function copyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "innetwork-mut-"));
  for (const d of ["src", "server", "fixtures", "package.json", "tsconfig.json"]) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
  return dir;
}

export function runMutation(m: Mutation): MutationRow {
  const t0 = Date.now();
  const dir = copyRepo();
  try {
    const f = join(dir, m.file);
    const src = readFileSync(f, "utf8");
    const applied = src.split(m.find).length - 1;
    if (applied !== 1) return { id: m.id, gate: m.gate, applied, killed: false, failing: `mutation applied ${applied} times (must be 1)`, ms: Date.now() - t0 };
    writeFileSync(f, src.replace(m.find, m.replace));
    const r = spawnSync(process.execPath, ["--test", "--test-timeout=60000", ...m.tests], { cwd: dir, encoding: "utf8", env: { ...process.env, LIVE: "", INNETWORK_DATA_DIR: join(dir, "data") } });
    const out = r.stdout + r.stderr;
    const failing = out.split("\n").filter((l) => l.startsWith("✖ ")).map((l) => l.slice(2).replace(/\s*\([\d.]+ms\)$/, "")).filter((v, i, a) => a.indexOf(v) === i);
    const killed = r.status !== 0 && failing.some((l) => m.expectFailing.test(l));
    return { id: m.id, gate: m.gate, applied, killed, failing: failing.slice(0, 2).join(" | ") || `exit ${r.status}`, ms: Date.now() - t0 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Control: the unmutated copy must be green (otherwise "killed" would mean nothing). */
export function controlRun(): { green: boolean; detail: string } {
  const dir = copyRepo();
  try {
    const r = spawnSync(process.execPath, ["--test", "--test-timeout=60000", "src/core/core.test.ts", "server/server.test.ts"], { cwd: dir, encoding: "utf8", env: { ...process.env, LIVE: "", INNETWORK_DATA_DIR: join(dir, "data") } });
    const pass = (r.stdout.match(/ℹ pass (\d+)/) ?? [])[1];
    const fail = (r.stdout.match(/ℹ fail (\d+)/) ?? [])[1];
    return { green: r.status === 0, detail: `exit ${r.status} · pass ${pass} · fail ${fail}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const c = controlRun();
  console.log(`control (unmutated copy): ${c.green ? "green" : "RED"} · ${c.detail}`);
  let survived = c.green ? 0 : 1;
  for (const m of MUTATIONS) {
    const r = runMutation(m);
    if (!r.killed) survived++;
    console.log(`${r.killed ? "KILLED  " : "SURVIVED"} ${r.id.padEnd(7)} ${r.gate.padEnd(52)} applied=${r.applied} ${r.ms}ms :: ${r.failing}`);
  }
  console.log(`${MUTATIONS.length - survived}/${MUTATIONS.length} mutations killed`);
  void existsSync;
  process.exit(survived ? 1 : 0);
}

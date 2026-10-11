// npm run verify — build -> start the MCP server (8797) and the host (5188/5189) as child processes (pid files in
// .pids/) -> protocol + story checks -> unit tests -> mutation checks -> static guards -> name guard (needs network)
// -> headless browser run of every beat with screenshots and screen comparisons -> PASS/FAIL table -> stop all.
// Exit code 1 on any FAIL. Offline by default (DIRECTORY_MODE=fixture). Ports: MCP_PORT, HOST_PORT, SANDBOX_PROXY_PORT.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/client";
import { runProtocolChecks, type Row } from "./protocol.ts";
import { runStaticGuards } from "./guards.ts";
import { MUTATIONS, runMutation, controlRun } from "./mutations.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PIDS = join(ROOT, ".pids");
const LOGS = join(ROOT, "logs");
const SCREENS = join(ROOT, "docs", "screens");
const ports = { mcp: Number(process.env.MCP_PORT ?? 8797), host: Number(process.env.HOST_PORT ?? 5188), proxy: Number(process.env.SANDBOX_PROXY_PORT ?? 5189) };
const MCP_URL = `http://127.0.0.1:${ports.mcp}/mcp`;
const HOST_URL = `http://127.0.0.1:${ports.host}/`;
const DATA_DIR = join(ROOT, "data", "verify");
const QUICK = process.argv.includes("--quick"); // skip mutations and the browser run (local iteration only; never for EVIDENCE)
mkdirSync(PIDS, { recursive: true });
mkdirSync(LOGS, { recursive: true });
rmSync(DATA_DIR, { recursive: true, force: true });

const out: string[] = [];
const log = (s: string) => { console.log(s); out.push(s); };
const version = (pkg: string) => JSON.parse(readFileSync(join(ROOT, "node_modules", ...pkg.split("/"), "package.json"), "utf8")).version;
async function isUp(url: string): Promise<boolean> { try { return (await fetch(url, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } }
async function waitUp(url: string, child: ChildProcess, name: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${name} exited early (code ${child.exitCode}); see logs/${name}.log`);
    if (await isUp(url)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`${name} not up at ${url} within 15s; see logs/${name}.log`);
}
function start(name: string, script: string, env: Record<string, string>): ChildProcess {
  const fd = openSync(join(LOGS, `${name}.log`), "w");
  const child = spawn(process.execPath, [script], { cwd: ROOT, stdio: ["ignore", fd, fd], env: { ...process.env, ...env } });
  writeFileSync(join(PIDS, `${name}.pid`), String(child.pid));
  return child;
}
async function stop(name: string, child: ChildProcess | undefined): Promise<void> {
  if (child && child.exitCode === null) {
    const exited = new Promise((r) => child.once("exit", r));
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  rmSync(join(PIDS, `${name}.pid`), { force: true });
}
const testCounts = (txt: string) => { const n = (k: string) => Number(txt.match(new RegExp(`ℹ ${k} (\\d+)`))?.[1] ?? NaN); return { tests: n("tests"), pass: n("pass"), fail: n("fail") }; };

log(`# verify run ${new Date().toISOString()}${QUICK ? " (QUICK: no mutations, no browser — not for EVIDENCE)" : ""}`);
log(`node ${process.version} | @modelcontextprotocol/client ${version("@modelcontextprotocol/client")} | server ${version("@modelcontextprotocol/server")} | node-adapter ${version("@modelcontextprotocol/node")} | ext-apps ${version("@modelcontextprotocol/ext-apps")} | playwright ${version("playwright")}`);
log(`SDK client LATEST_PROTOCOL_VERSION=${LATEST_PROTOCOL_VERSION}; server: 2025-11-25 strict sessions + 2026-07-28 via isLegacyRequest/createMcpHandler; DIRECTORY_MODE=${process.env.DIRECTORY_MODE ?? "fixture"}`);

if (existsSync(join(ROOT, "build.ts"))) {
  const b = spawnSync(process.execPath, ["build.ts"], { cwd: ROOT, encoding: "utf8" });
  log(`build: exit ${b.status} ${(b.stdout + b.stderr).trim()}`);
  if (b.status !== 0) process.exit(1);
} else {
  log("build: build.ts not in this tree yet (host lane) - views are not built; P6 will fail");
}
for (const url of [MCP_URL.replace("/mcp", "/healthz"), `${HOST_URL}healthz`, "http://127.0.0.1:8799/healthz"]) {
  if (await isUp(url)) { log(`ABORT: something already answers ${url} (stale server? check .pids/ and lsof)`); process.exit(1); }
}

const serverEnv = { INNETWORK_DATA_DIR: DATA_DIR, DIRECTORY_MODE: process.env.DIRECTORY_MODE ?? "fixture", HOST_PORT: String(ports.host), ...(process.env.INNETWORK_DIRECTORY ? { INNETWORK_DIRECTORY: process.env.INNETWORK_DIRECTORY } : {}) };
let server: ChildProcess | undefined, host: ChildProcess | undefined;
const rows: Row[] = [];
const add = (r: Row) => { rows.push(r); log(`${r.pass ? "PASS" : "FAIL"} ${r.id} ${r.check} :: ${r.actual}`); };
try {
  server = start("server", "server/server.ts", { ...serverEnv, MCP_PORT: String(ports.mcp) });
  await waitUp(MCP_URL.replace("/mcp", "/healthz"), server, "server");
  if (existsSync(join(ROOT, "host", "serve.ts"))) {
    host = start("host", "host/serve.ts", { HOST_PORT: String(ports.host), SANDBOX_PROXY_PORT: String(ports.proxy), MCP_PORT: String(ports.mcp) });
    await waitUp(`${HOST_URL}healthz`, host, "host");
  }
  log(`servers up: mcp pid ${server.pid}${host ? `, host pid ${host.pid}` : " (host not in this tree yet)"}; data ${DATA_DIR}`);

  rows.push(...(await runProtocolChecks({ mcpUrl: MCP_URL, dataDir: DATA_DIR, serverEnv, hostOrigin: `http://127.0.0.1:${ports.host}` }, log)));

  const t = spawnSync(process.execPath, ["--test", "--test-timeout=60000", "src/**/*.test.ts", "server/**/*.test.ts"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, LIVE: "", INNETWORK_DATA_DIR: join(DATA_DIR, "unit") } });
  writeFileSync(join(LOGS, "unit-tests.log"), t.stdout + t.stderr);
  const c = testCounts(t.stdout + t.stderr);
  add({ id: "C1", check: "unit + tool tests (npm test: core gate, schedule, linter, intent, MCP tools end to end)", expected: "exit 0, fail 0", actual: `exit ${t.status} · tests ${c.tests} · pass ${c.pass} · fail ${c.fail}`, pass: t.status === 0 && c.fail === 0 && c.pass > 0 });

  const sk = spawnSync(process.execPath, ["--test", "--test-timeout=60000", "skill/test/skill.test.ts"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, INNETWORK_DATA_DIR: join(DATA_DIR, "skill") } });
  writeFileSync(join(LOGS, "skill-tests.log"), sk.stdout + sk.stderr);
  const skc = testCounts(sk.stdout + sk.stderr);
  add({ id: "C3", check: "classic Alexa skill as an MCP client (APL card, voice only, consent, deadline, unsigned request rejected)", expected: "exit 0, fail 0", actual: `exit ${sk.status} · tests ${skc.tests} · pass ${skc.pass} · fail ${skc.fail}`, pass: sk.status === 0 && skc.fail === 0 && skc.pass > 0 });

  if (existsSync(join(ROOT, "packages", "plannet-directory-check", "package.json"))) {
    const pk = spawnSync(process.execPath, ["--test", "--test-timeout=60000"], { cwd: join(ROOT, "packages", "plannet-directory-check"), encoding: "utf8", env: { ...process.env, LIVE: "" } });
    const pc = testCounts(pk.stdout + pk.stderr);
    writeFileSync(join(LOGS, "package-tests.log"), pk.stdout + pk.stderr);
    add({ id: "C2", check: "open-source package plannet-directory-check: offline tests", expected: "exit 0, fail 0", actual: `exit ${pk.status} · tests ${pc.tests} · pass ${pc.pass} · fail ${pc.fail}`, pass: pk.status === 0 && pc.fail === 0 && pc.pass > 0 });
  }

  if (!QUICK) {
    const ctl = controlRun();
    add({ id: "M0", check: "mutation control: the unmutated copy is green", expected: "green", actual: ctl.detail, pass: ctl.green });
    let killed = 0;
    const survivors: string[] = [];
    for (const m of MUTATIONS) { const r = runMutation(m); if (r.killed) killed++; else survivors.push(`${r.id} (${r.failing})`); log(`  ${r.killed ? "killed  " : "SURVIVED"} ${r.id} ${r.gate} · applied=${r.applied}`); }
    add({ id: "M1", check: "mutation checks: each refusal broken in a throwaway copy turns its test red (N1-N13)", expected: `${MUTATIONS.length}/${MUTATIONS.length} killed`, actual: `${killed}/${MUTATIONS.length} killed${survivors.length ? ` · survived: ${survivors.join(", ")}` : ""}`, pass: killed === MUTATIONS.length });
  }

  rows.push(...runStaticGuards(log));

  if (existsSync(join(ROOT, "scripts", "guard-names.ts"))) {
    const g = spawnSync(process.execPath, ["scripts/guard-names.ts"], { cwd: ROOT, encoding: "utf8" });
    writeFileSync(join(LOGS, "guard-names.log"), g.stdout + g.stderr);
    const last = (g.stdout + g.stderr).trim().split("\n").slice(-2).join(" · ").slice(0, 200);
    if (/network|ENOTFOUND|fetch failed|ECONN/i.test(last) && g.status !== 0) log(`NOTE G9 name guard needs the NPPES API (network): ${last} - not counted`);
    else add({ id: "G9", check: "name guard: every fictional doctor name has 0 matches in NPPES (FL and US) and in the live pool; control lights", expected: "exit 0", actual: `exit ${g.status} · ${last}`, pass: g.status === 0 });
  }

  if (!QUICK && host && existsSync(join(ROOT, "verify", "browser.ts"))) {
    const { runBrowserChecks } = await import(pathToFileURL(join(ROOT, "verify", "browser.ts")).href) as { runBrowserChecks: (o: { hostUrl: string; screensDir: string; mcpUrl: string }, log: (s: string) => void) => Promise<Row[]> };
    rows.push(...(await runBrowserChecks({ hostUrl: HOST_URL, screensDir: SCREENS, mcpUrl: MCP_URL }, log)));
  } else if (!QUICK) {
    add({ id: "B0", check: "browser run of every beat (host + views)", expected: "host/serve.ts and verify/browser.ts present", actual: `host=${!!host} browser.ts=${existsSync(join(ROOT, "verify", "browser.ts"))}`, pass: false });
  }
} catch (err) {
  rows.push({ id: "X", check: "harness", expected: "no exception", actual: String((err as Error).stack ?? err).slice(0, 400), pass: false });
  log(`HARNESS ERROR: ${String((err as Error).stack ?? err)}`);
} finally {
  await stop("host", host);
  await stop("server", server);
  log(`servers stopped (mcp alive=${await isUp(MCP_URL.replace("/mcp", "/healthz"))}, host alive=${await isUp(`${HOST_URL}healthz`)})`);
}

const w = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
log("");
log(`| ${w("id", 4)} | ${w("result", 6)} | ${w("check", 78)} | actual`);
log(`|${"-".repeat(6)}|${"-".repeat(8)}|${"-".repeat(80)}|-------`);
for (const r of rows) log(`| ${w(r.id, 4)} | ${w(r.pass ? "PASS" : "FAIL", 6)} | ${w(r.check, 78)} | ${r.actual}`);
const failed = rows.filter((r) => !r.pass).length;
log("");
log(`TOTAL ${rows.length} checks: ${rows.length - failed} PASS, ${failed} FAIL`);
writeFileSync(join(LOGS, "verify-latest.txt"), out.join("\n") + "\n");
if (!QUICK) writeFileSync(join(LOGS, "verify-latest.json"), JSON.stringify(rows, null, 2));
process.exit(failed ? 1 : 0);

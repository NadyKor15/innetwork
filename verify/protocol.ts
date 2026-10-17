// Node-side checks against the running InNetwork MCP server.
//   P*  protocol: initialize, headers, tools/list, ui:// resources
//   T*  the demo story through every tool (Alexa's lines word for word, SPEC §2), screens' data
//   S*  state survives a new session, a 2026-07-28 client and a real server restart
//   N*  negative controls (unknown session, foreign Origin, missing account link, strict protocol, bad input)
//   G*  guards: household files (N4), speech linter and voice budget, no tool names on customer cards
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lintSpeech, words } from "../src/core/lint.ts";
import { forbiddenKeys } from "../server/store.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export type Row = { id: string; check: string; expected: string; actual: string; pass: boolean };
const ACCEPT = "application/json, text/event-stream";
const TARGET = "2025-11-25";
const MODERN = "2026-07-28";
const MODES = new Set(["live", "file", "fixture", "sandbox", "simulated"]);

/** SPEC §2 lines, word for word (what the video plays). */
export const SPEC_LINES = {
  openingReadBack: "One doctor each, in their own plan. Book all three?",
  openingBooked: "Booked.",
  oopNote: "Out-of-pocket max met · plans usually pay 100% of covered in-network care until Dec 31 · Source: HealthCare.gov glossary",
  plan: "Your gastroenterologist is already booked for Thursday. Tuesday, same clinic: primary care, then OB-GYN. Friday: dermatology. All while he's at daycare. Book these three?",
  booked: "Booked. Details in your Alexa app and email. Say cancel anytime.",
  status: "Four booked. Lab work comes after Tuesday's visit.",
  setAside: "I checked six nearby. Two don't see children under three, one isn't in his plan. These two fit.",
};
export const VIDEO_ALEXA_LINES = [SPEC_LINES.openingReadBack, SPEC_LINES.openingBooked, SPEC_LINES.plan, SPEC_LINES.booked, SPEC_LINES.status, SPEC_LINES.setAside];
export const TOOLS = ["book_visit", "cancel_visit", "check_doctor", "checkup_year", "consent", "doctor_notes", "family_plans", "family_routine", "find_in_network"];
export const VIEW_OF: Record<string, string | null> = { consent: "consent", find_in_network: "family-match", book_visit: "booked", cancel_visit: "booked", checkup_year: "visit-plan", family_plans: null, family_routine: null, doctor_notes: null, check_doctor: null };
/** Tool names, JSON and internal ids must never reach a customer card. */
export const TOOL_OR_ID = /\b(find_in_network|book_visit|cancel_visit|checkup_year|check_doctor|family_plans|family_routine|doctor_notes|in_network|out_of_network|does_not_see_this_age|age_not_listed|not_confirmed)\b|\bSBX-[0-9A-F]{8}\b|\bplan-[abc]\b|[{}]|\bLIVE FHIR\b|\bFIXTURE\b|\bSANDBOX\b|★|checked today/;
const strings = (o: unknown): string[] => (typeof o === "string" ? [o] : Array.isArray(o) ? o.flatMap(strings) : o && typeof o === "object" ? Object.values(o).flatMap(strings) : []);
const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type Raw = { status: number; headers: Headers; body: any; text: string };
const auth = (user: string) => ({ Authorization: `Bearer innet-sandbox-${user}` });
async function raw(url: string, method: string, message: unknown, headers: Record<string, string> = {}): Promise<Raw> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json", Accept: ACCEPT, ...headers }, body: message === undefined ? undefined : JSON.stringify(message) });
  const text = await res.text();
  let body: any;
  const dataLines = text.split("\n").filter((l) => l.startsWith("data:"));
  try { body = dataLines.length ? JSON.parse(dataLines[dataLines.length - 1].slice(5)) : text ? JSON.parse(text) : undefined; } catch { body = undefined; }
  return { status: res.status, headers: res.headers, body, text };
}
const init = (protocolVersion: string, id = 1) => ({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion, capabilities: {}, clientInfo: { name: "verify-raw", version: "0" } } });
const initialized = { jsonrpc: "2.0", method: "notifications/initialized" };
const listTools = (id = 2) => ({ jsonrpc: "2.0", id, method: "tools/list", params: {} });
async function rawSession(url: string, version: string, extra: Record<string, string>) {
  const r = await raw(url, "POST", init(version), extra);
  const sid = r.headers.get("mcp-session-id") ?? "";
  if (sid) await raw(url, "POST", initialized, { "mcp-session-id": sid, "mcp-protocol-version": r.body?.result?.protocolVersion ?? version, ...extra });
  return { r, sid };
}
async function session(url: string, user: string, opts?: Record<string, unknown>) {
  const c = new Client({ name: "verify-node", version: "0.1.0" }, opts as never);
  const t = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: auth(user) } });
  await c.connect(t);
  return { c, t, close: async () => { await t.terminateSession().catch(() => {}); await c.close(); } };
}
type Out = { r: CallToolResult; sc: any; steps: any[]; speech: string; parts: string[] };
const SURFACE: { tool: string; speech: string[]; card: string[] }[] = [];
async function call(c: Client, name: string, args: Record<string, unknown>): Promise<Out> {
  const r = (await c.callTool({ name, arguments: args })) as CallToolResult;
  const sc = (r.structuredContent ?? {}) as any;
  SURFACE.push({ tool: name, speech: sc.speechParts ?? [sc.speech ?? ""], card: strings(sc.card ?? {}) });
  return { r, sc, steps: ((r._meta as any)?.steps ?? []) as any[], speech: sc.speech ?? "", parts: sc.speechParts ?? [] };
}
const stepsValid = (steps: any[]) => steps.length > 0 && steps.every((s) => typeof s.service === "string" && typeof s.op === "string" && MODES.has(s.mode) && typeof s.ms === "number" && typeof s.summary === "string");

async function spawnServer(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["server/server.ts", "--port", String(port)], { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...env } });
  writeFileSync(join(ROOT, ".pids", "restart-check.pid"), String(child.pid));
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`restart-check server exited early (${child.exitCode})`);
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return child; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill("SIGKILL");
  throw new Error("restart-check server did not come up");
}
async function killServer(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((r) => child.once("exit", r));
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  rmSync(join(ROOT, ".pids", "restart-check.pid"), { force: true });
}

const OPENING = { requests: [
  { member: "Mom", specialty: "gastroenterology" },
  { member: "Older child", specialty: "allergy", age_for_this_search: "5" },
  { member: "Youngest", specialty: "orthopedics", age_for_this_search: "under 2" },
] };
const CHECKUP = { action: "plan", items: ["primary_care", "ob_gyn", "dermatology", "gastroenterology", "lab_work"], oop_met: true };

export async function runProtocolChecks(opts: { mcpUrl: string; dataDir: string; serverEnv: Record<string, string>; hostOrigin: string }, log: (s: string) => void): Promise<Row[]> {
  const { mcpUrl, dataDir } = opts;
  const rows: Row[] = [];
  const add = (id: string, check: string, expected: string, actual: string, pass: boolean) => { rows.push({ id, check, expected, actual, pass }); log(`${pass ? "PASS" : "FAIL"} ${id} ${check} :: ${actual}`); };
  const stamp = Date.now().toString(36);
  const userA = `verify-a-${stamp}`;
  SURFACE.length = 0;

  // ---------- P: protocol ----------
  const health = await (await fetch(mcpUrl.replace("/mcp", "/healthz"))).json() as { directoryMode: string };
  const seen: { method: string; reqProto: string | null }[] = [];
  const recordingFetch: typeof fetch = async (input, initArg) => {
    const res = await fetch(input, initArg);
    let method = "?";
    try { method = JSON.parse(String(initArg?.body ?? "{}")).method ?? "?"; } catch { /* body-less */ }
    seen.push({ method, reqProto: new Headers(initArg?.headers).get("mcp-protocol-version") });
    return res;
  };
  const cA = new Client({ name: "verify-node", version: "0.1.0" });
  const tA = new StreamableHTTPClientTransport(new URL(mcpUrl), { fetch: recordingFetch, requestInit: { headers: auth(userA) } });
  await cA.connect(tA);
  add("P1", "initialize negotiates protocolVersion (official client)", `"${TARGET}" + Mcp-Session-Id`, `${JSON.stringify(cA.getNegotiatedProtocolVersion())} sid=${tA.sessionId ? "present" : "MISSING"}`, cA.getNegotiatedProtocolVersion() === TARGET && !!tA.sessionId);
  const toolList = (await cA.listTools()).tools;
  const names = toolList.map((t) => t.name).sort();
  add("P2", "tools/list: the nine InNetwork tools", TOOLS.join(","), names.join(","), JSON.stringify(names) === JSON.stringify(TOOLS));
  const hdr = seen.find((s) => s.method === "tools/list");
  add("P3", "client sends MCP-Protocol-Version after init", `"${TARGET}"`, JSON.stringify(hdr?.reqProto), hdr?.reqProto === TARGET);
  const uiLinks = toolList.map((t) => `${t.name}->${(t._meta as any)?.ui?.resourceUri ?? "none"}`);
  add("P4", "tools with a screen link their MCP App view; data-only tools have none", "ui://innetwork/<view>.html", uiLinks.join(" "),
    toolList.every((t) => (VIEW_OF[t.name] === null ? !(t._meta as any)?.ui : (t._meta as any)?.ui?.resourceUri === `ui://innetwork/${VIEW_OF[t.name]}.html`)));
  const inputs = toolList.flatMap((t) => Object.keys(((t.inputSchema as any)?.properties ?? {}) as object).map((k) => `${t.name}.${k}`));
  const childInputs = toolList.flatMap((t) => JSON.stringify(t.inputSchema).match(/"(dob|date_of_birth|birth\w*|age_band|name|first_name|last_name|member_id\w*|symptoms?|diagnos\w*)"/gi) ?? []);
  add("P5", "no tool takes symptoms, names, dates of birth or member IDs (N1, N4, N5)", "0 such fields", `${childInputs.length ? childInputs.join(",") : "none"} among ${inputs.length} top-level fields`, childInputs.length === 0);
  const res = (await cA.listResources()).resources.map((r) => r.uri).sort();
  const reads: string[] = [];
  let readsOk = res.length === 6;
  for (const uri of res) {
    const rr = await cA.readResource({ uri }).catch((e: Error) => ({ contents: [{ mimeType: `error: ${e.message.slice(0, 60)}`, text: "" }] }));
    const ct = rr.contents[0] as { mimeType?: string; text?: string };
    const v = uri.match(/ui:\/\/innetwork\/([\w-]+)\.html/)?.[1];
    const ok = ct?.mimeType === "text/html;profile=mcp-app" && /^<!doctype html>/i.test(ct.text ?? "") && !!ct.text?.includes(`data-file="${v}"`);
    readsOk &&= ok;
    reads.push(`${v}:${ok ? "ok" : "BAD"}(${Math.round((ct?.text?.length ?? 0) / 1024)}KB)`);
  }
  add("P6", "all six ui:// views readable as MCP App HTML", "booked, checkup-year, consent, family-match, set-aside, visit-plan", reads.join(" "), readsOk);
  add("P7", "directory is src/directory (recorded samples / live), not the unit-test double", "mode fixture|auto|live, no test double", `mode=${health.directoryMode} plans=${(await (await fetch(mcpUrl.replace("/mcp", "/devinfo"))).json() as any).plans.map((p: any) => `${p.label}:${p.kind}`).join(",")}`,
    process.env.INNETWORK_DIRECTORY !== "dev" && opts.serverEnv.INNETWORK_DIRECTORY !== "dev");

  // ---------- T: the demo story (SPEC §2) ----------
  const pre = await call(cA, "find_in_network", OPENING);
  add("T1", "N6: before consent, nothing is looked up; the consent screen comes back", "isError, consentRequired, view consent, no directory step", `isError=${!!pre.r.isError} view=${pre.sc.card?.view} steps=${pre.steps.map((s) => s.service).join(",")}`,
    !!pre.r.isError && pre.sc.data?.consentRequired === true && pre.sc.card?.view === "consent" && !pre.steps.some((s) => /ZIP/.test(s.op)));
  const show = await call(cA, "consent", { action: "show" });
  const allow = await call(cA, "consent", { action: "allow" });
  add("T2", "consent: purpose and the §13 disclaimer by voice once, then allowed", "disclaimer in the first line; 'allowed'", `${short(show.speech, 70)} | ${allow.speech}`, /not a substitute for professional medical advice/.test(show.speech) && allow.sc.data?.consent === "granted");

  const open = await call(cA, "find_in_network", OPENING);
  const rows0 = open.sc.card?.rows ?? [];
  add("T3", "opening: one phrase, three people, three plans (SPEC line)", SPEC_LINES.openingReadBack, open.speech, open.speech === SPEC_LINES.openingReadBack);
  const want = [["Mom", "Plan A", "Gastroenterology", "Dr. Marisol Venterra", "Thu Oct 22 · 9:15 AM"], ["Older child", "Plan B", "Allergy", "Dr. Ansel Quillfeather", "Wed Oct 21 · 2:30 PM"], ["Youngest", "Plan C", "Orthopedics", "Dr. Imogen Pellworth", "Mon Oct 19 · 1:30 PM"]];
  const got = rows0.map((r: any) => [r.memberLabel, r.planLabel, r.specialty, r.fit?.name, r.fit?.when]);
  add("T4", "opening rows: doctor and time per person, inside the routine (N12)", JSON.stringify(want), JSON.stringify(got), JSON.stringify(got) === JSON.stringify(want));
  const aside = rows0[2]?.setAside ?? [];
  add("T5", "youngest's row: set aside with the reason (N2, N3); note on the older child's doctor (N13)", "Wrenfield under 3 · Ardley not in his plan's network · note 'great with kids'", `${aside.map((a: any) => `${a.name}: ${a.reason}`).join(" | ")} | note=${rows0[1]?.fit?.note}`,
    aside[0]?.reason === "Doesn't see children under 3" && aside[1]?.reason === "Not in his plan's network" && rows0[1]?.fit?.note === "great with kids");
  add("T6", "every tools/call names its sources (steps with a mode)", "steps valid; directory steps present", open.steps.map((s) => `${s.mode}:${s.service}`).slice(0, 4).join(" > "), stepsValid(open.steps) && open.steps.some((s) => /ZIP/.test(s.op)));
  const ob = await call(cA, "book_visit", { confirm: true });
  add("T7", "opening booked (voice) + written confirmation queued (§15)", SPEC_LINES.openingBooked, `${ob.speech} | ${ob.steps.filter((s) => /Written confirmation/.test(s.service)).map((s) => s.summary).join("")}`, ob.speech === SPEC_LINES.openingBooked && ob.steps.some((s) => /Written confirmation/.test(s.service)));

  const plan = await call(cA, "checkup_year", CHECKUP);
  add("T8", "scene 1: OOP line on the screen with 'usually' and HealthCare.gov (N9), not spoken", SPEC_LINES.oopNote, `${plan.sc.card?.note} | parts ${plan.parts.length}`, plan.sc.card?.note === SPEC_LINES.oopNote && plan.parts.length === 1);
  add("T9", "scene 1: plan read back around the routine; lab work waits on the screen (N10, N12)", SPEC_LINES.plan, `${plan.parts[0] ?? ""} | ${plan.sc.card?.lab}`, plan.parts[0] === SPEC_LINES.plan && /^Lab work — may need an order/.test(String(plan.sc.card?.lab ?? "")));
  const docs = (plan.sc.card?.doctors ?? []).map((d: any) => `${d.specialty}|${d.name}|${d.when}|${d.tag ?? ""}`);
  add("T10", "visit plan screen: four doctors, same clinic, already booked", "PC Tue 9:00 · OB Tue 10:15 · GI Thu 9:15 (Already booked) · Derm Fri 9:30", docs.join(" ; "),
    docs.join(";") === ["Primary care|Dr. Rowena Thistlewood|Tue Oct 20 · 9:00 AM|same clinic", "OB-GYN|Dr. Linnea Marchbank|Tue Oct 20 · 10:15 AM|same clinic", "Gastroenterology|Dr. Marisol Venterra|Thu Oct 22 · 9:15 AM|Already booked", "Dermatology|Dr. Ottilie Brennagh|Fri Oct 23 · 9:30 AM|"].join(";"));
  const pb = await call(cA, "book_visit", { confirm: true });
  add("T11", "scene 1 booked: voice + Alexa app + email + cancel anytime (§15)", SPEC_LINES.booked, `${pb.speech} | ${pb.sc.card?.title} | ${pb.sc.card?.subtitle}`, pb.speech === SPEC_LINES.booked && pb.sc.card?.title === "Booked · 3 visits" && pb.sc.card?.subtitle === "All between 8:30 and 11, while he's at daycare");
  const lab = await call(cA, "book_visit", { item: "lab_work", confirm: true });
  add("T12", "N10: lab work is not booked before the primary care visit", "isError, refused N10", `isError=${!!lab.r.isError} refused=${lab.sc.data?.refused} | ${lab.speech}`, !!lab.r.isError && lab.sc.data?.refused === "N10");

  // ---------- S: state ----------
  const sid1 = tA.sessionId!;
  await tA.terminateSession();
  await cA.close();
  const gone = await raw(mcpUrl, "POST", listTools(), { "mcp-session-id": sid1, "mcp-protocol-version": TARGET, ...auth(userA) });
  add("S1", "old session id rejected after DELETE", "HTTP 404", `HTTP ${gone.status}`, gone.status === 404);
  const a2 = await session(mcpUrl, userA);
  const st = await call(a2.c, "checkup_year", { action: "status" });
  add("S2", "new session: 'what's left' from saved state (SPEC line)", SPEC_LINES.status, `sid ${sid1.slice(0, 8)}…->${a2.t.sessionId?.slice(0, 8)}… | ${st.speech}`, a2.t.sessionId !== sid1 && st.speech === SPEC_LINES.status);
  const sa = await call(a2.c, "find_in_network", { requests: [{ member: "my youngest", specialty: "orthopedics", age_for_this_search: "under two" }] });
  add("T13", "scene 2: six checked, two set aside by age, one by network, two fit (SPEC line)", SPEC_LINES.setAside, sa.speech, sa.speech === SPEC_LINES.setAside);
  const saCard = sa.sc.card ?? {};
  add("T14", "set aside screen: reasons, 'age not listed' in yellow, age not saved (N3, N4)", "Wrenfield, Ashgrove: under 3 · Ardley: network · Hartsworth: ask office · footer", `${(saCard.setAside ?? []).map((x: any) => `${x.name.split(" ").pop()}:${x.kind}`).join(",")} | ${saCard.footer}`,
    JSON.stringify((saCard.setAside ?? []).map((x: any) => x.kind)) === JSON.stringify(["age", "age", "network", "ask_office"]) && saCard.footer === "Age used for this search only · not saved");
  await a2.close();
  const fresh = await session(mcpUrl, `verify-fresh-${stamp}`);
  await call(fresh.c, "consent", { action: "allow" });
  const none = await call(fresh.c, "checkup_year", { action: "status" });
  await fresh.close();
  add("S3", "control: a different household has nothing booked", "'Zero booked.'", short(none.speech, 60), /^Zero booked\./.test(none.speech));
  const m = await session(mcpUrl, userA, { versionNegotiation: { mode: "auto" } });
  const mv = m.c.getNegotiatedProtocolVersion();
  const mst = await call(m.c, "checkup_year", { action: "status" });
  await m.c.close();
  add("S4", "2026-07-28 client on the same endpoint, same saved state", `"${MODERN}", no session id, same line`, `${JSON.stringify(mv)} sid=${m.t.sessionId ?? "none"} | ${mst.speech}`, mv === MODERN && !m.t.sessionId && mst.speech === SPEC_LINES.status && stepsValid(mst.steps));
  const restartUrl = "http://127.0.0.1:8799/mcp";
  let p = await spawnServer(8799, opts.serverEnv);
  const pid1 = p.pid;
  let restart = "", restartOk = false;
  try {
    const r1 = await session(restartUrl, userA); const s1 = await call(r1.c, "checkup_year", { action: "status" }); await r1.close();
    await killServer(p);
    p = await spawnServer(8799, opts.serverEnv);
    const r2 = await session(restartUrl, userA); const s2 = await call(r2.c, "checkup_year", { action: "status" }); await r2.close();
    restart = `pid ${pid1} -> ${p.pid} | ${s1.speech} == ${s2.speech}`;
    restartOk = pid1 !== p.pid && s1.speech === SPEC_LINES.status && s2.speech === SPEC_LINES.status;
  } catch (e) { restart = String(e); } finally { await killServer(p); }
  add("S5", "state survives a server process restart", "same line from a new process", restart, restartOk);

  // ---------- N: negative controls ----------
  const n1 = await raw(mcpUrl, "POST", listTools(5), { "mcp-session-id": "00000000-0000-0000-0000-000000000000", "mcp-protocol-version": TARGET, ...auth(userA) });
  add("N1", "unknown Mcp-Session-Id", "HTTP 404", `HTTP ${n1.status}`, n1.status === 404);
  const evil = await raw(mcpUrl, "POST", init(TARGET), { Origin: "http://evil.example", ...auth(userA) });
  add("N2", "initialize from a foreign Origin (DNS-rebinding guard)", "HTTP 403", `HTTP ${evil.status}`, evil.status === 403);
  const noAuth = await raw(mcpUrl, "POST", init(TARGET));
  add("N3", "initialize without the (simulated) account link", "HTTP 401 + WWW-Authenticate", `HTTP ${noAuth.status} www-authenticate=${noAuth.headers.get("www-authenticate")}`, noAuth.status === 401 && !!noAuth.headers.get("www-authenticate"));
  const preflight = await fetch(mcpUrl, { method: "OPTIONS", headers: { Origin: opts.hostOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type,mcp-session-id,mcp-protocol-version" } });
  add("N4", "CORS preflight from the host origin", "204, allow-origin, Mcp-Session-Id exposed", `HTTP ${preflight.status} allow-origin=${preflight.headers.get("access-control-allow-origin")}`,
    preflight.status === 204 && preflight.headers.get("access-control-allow-origin") === opts.hostOrigin && /mcp-session-id/i.test(preflight.headers.get("access-control-expose-headers") ?? ""));
  const old = await rawSession(mcpUrl, "2024-11-05", auth(userA));
  add("N5", "strict: initialize asks 2024-11-05", `answers "${TARGET}"`, `result.protocolVersion=${JSON.stringify(old.r.body?.result?.protocolVersion)}`, old.r.body?.result?.protocolVersion === TARGET);
  if (old.sid) await raw(mcpUrl, "DELETE", undefined, { "mcp-session-id": old.sid, ...auth(userA) });
  const good = await rawSession(mcpUrl, TARGET, auth(userA));
  const hOld = await raw(mcpUrl, "POST", listTools(6), { "mcp-session-id": good.sid, "mcp-protocol-version": "2024-11-05", ...auth(userA) });
  add("N6", "strict: header MCP-Protocol-Version 2024-11-05 on a 2025-11-25 session", "HTTP 400", `HTTP ${hOld.status}`, hOld.status === 400);
  const steal = await raw(mcpUrl, "POST", listTools(8), { "mcp-session-id": good.sid, "mcp-protocol-version": TARGET, ...auth(`intruder-${stamp}`) });
  add("N7", "another account reusing someone's session id", "HTTP 403", `HTTP ${steal.status}`, steal.status === 403);
  const noSid = await raw(mcpUrl, "POST", listTools(9), { "mcp-protocol-version": TARGET, ...auth(userA) });
  add("N8", "non-initialize request without Mcp-Session-Id", "HTTP 400", `HTTP ${noSid.status}`, noSid.status === 400);
  if (good.sid) await raw(mcpUrl, "DELETE", undefined, { "mcp-session-id": good.sid, ...auth(userA) });
  const v = await session(mcpUrl, userA);
  const sym = await v.c.callTool({ name: "find_in_network", arguments: { requests: [{ member: "Mom", specialty: "gastroenterology", symptoms: "stomach ache" }] } }) as CallToolResult;
  const badSpec = await v.c.callTool({ name: "find_in_network", arguments: { requests: [{ member: "Mom", specialty: "whatever helps" }] } }) as CallToolResult;
  const longNote = await v.c.callTool({ name: "doctor_notes", arguments: { action: "add", doctor: "Dr. X", text: "x".repeat(500) } }) as CallToolResult;
  const noAge = await call(v.c, "find_in_network", { requests: [{ member: "Youngest", specialty: "orthopedics" }] });
  await v.close();
  add("N9", "input: no symptoms field, closed specialty list, bounded text, a child's search needs the age said now (N1, N4)", "isError x3 + asks the age", `symptoms=${!!sym.isError} specialty=${!!badSpec.isError} 500-char note=${!!longNote.isError} | ${noAge.speech}`,
    !!sym.isError && !!badSpec.isError && !!longNote.isError && /How old is he\? I use it for this search only\./.test(noAge.speech));

  // ---------- G: guards ----------
  const users = existsSync(join(dataDir, "users")) ? readdirSync(join(dataDir, "users")).filter((f) => f.endsWith(".json")) : [];
  const bad = users.flatMap((f) => forbiddenKeys(JSON.parse(readFileSync(join(dataDir, "users", f), "utf8"))).map((k) => `${f}:${k}`));
  const ageText = users.filter((f) => /under (2|two)\b/.test(readFileSync(join(dataDir, "users", f), "utf8")));
  add("G1", "N4: household files hold no ages, names, dates of birth, program types", `0 forbidden keys in ${users.length} files; no age band text`, `${bad.length ? bad.slice(0, 3).join(",") : "0 keys"} · age text in ${ageText.length} files`, users.length > 0 && bad.length === 0 && ageText.length === 0);
  const lint = SURFACE.flatMap((s) => s.speech.map((t) => ({ t, issues: lintSpeech(t) }))).filter((x) => x.issues.length);
  add("G2", "every Alexa line of this run passes the linter (N5/N7/N9, ≤20 s)", "0 issues", lint.length ? lint.map((x) => `${x.issues[0].rule}: ${short(x.t, 40)}`).slice(0, 3).join(" | ") : `0 issues in ${SURFACE.reduce((n, s) => n + s.speech.length, 0)} lines`, lint.length === 0);
  const total = VIDEO_ALEXA_LINES.reduce((n, l) => n + words(l), 0);
  const longest = Math.max(...VIDEO_ALEXA_LINES.map((l) => words(l) / 2.5));
  add("G3", "voice budget of the video's Alexa lines (SPEC §2)", "≤ 110 words, each ≤ 20 s", `${total} words ≈ ${(total / 2.5).toFixed(1)} s · longest ${longest.toFixed(1)} s`, total <= 110 && longest <= 20);
  const leaks = SURFACE.flatMap((s) => s.card.filter((t) => TOOL_OR_ID.test(t)).map((t) => `${s.tool}: ${short(t, 40)}`));
  add("G4", "customer cards: no tool names, internal ids, JSON, source badges, stars", "0 leaks", leaks.length ? leaks.slice(0, 3).join(" | ") : `0 in ${SURFACE.reduce((n, s) => n + s.card.length, 0)} card strings`, leaks.length === 0);
  return rows;
}

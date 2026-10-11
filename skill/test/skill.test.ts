// The classic skill as an MCP client of a fresh InNetwork server (test-double directory, temp data dir).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const DATA = mkdtempSync(join(tmpdir(), "innetwork-skill-"));
process.env.INNETWORK_DATA_DIR = DATA;
process.env.INNETWORK_DIRECTORY = "dev";
const { startMcpServer } = await import("../../server/server.ts");
const { connectInNetwork } = await import("../src/mcp.ts");
const { buildSkill } = await import("../src/handler.ts");
let srv: Awaited<ReturnType<typeof startMcpServer>>;

before(async () => { srv = await startMcpServer({ port: 0, quiet: true }); });
after(async () => { await srv.close(); rmSync(DATA, { recursive: true, force: true }); });

const envelope = (request: Record<string, unknown>, screen = true, sessionId = "s-1") => ({
  version: "1.0",
  session: { new: true, sessionId, application: { applicationId: "amzn1.ask.skill.test" }, user: { userId: "amzn1.ask.account.test" } },
  context: { System: { application: { applicationId: "amzn1.ask.skill.test" }, user: { userId: "amzn1.ask.account.test" }, device: { deviceId: "d-1", supportedInterfaces: screen ? { "Alexa.Presentation.APL": { runtime: { maxVersion: "2024.3" } } } : {} } } },
  request: { requestId: "r-1", timestamp: new Date().toISOString(), locale: "en-US", ...request },
});
const speech = (r: any) => String(r.response?.outputSpeech?.ssml ?? "").replace(/<\/?speak>/g, "");

async function household(user: string) {
  const c = new Client({ name: "t", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(srv.url), { requestInit: { headers: { Authorization: `Bearer innet-sandbox-${user}` } } }));
  const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args });
  await call("consent", { action: "allow" });
  await call("find_in_network", { requests: [{ member: "Mom", specialty: "gastroenterology" }, { member: "Older child", specialty: "allergy", age_for_this_search: "5" }, { member: "Youngest", specialty: "orthopedics", age_for_this_search: "under 2" }] });
  await call("book_visit", { confirm: true });
  await call("checkup_year", { action: "plan", items: ["primary_care", "ob_gyn", "dermatology", "gastroenterology", "lab_work"], oop_met: true });
  await call("book_visit", { confirm: true });
  await c.close();
}

test("launch on an Echo Show: the saved checkup year, spoken and as an APL card", async () => {
  await household("skill-home");
  const skill = buildSkill({ innetwork: connectInNetwork({ url: srv.url, token: "innet-sandbox-skill-home" }) });
  const r: any = await skill.invoke(envelope({ type: "LaunchRequest" }) as never);
  assert.equal(speech(r), "Four booked. Lab work comes after Tuesday's visit.");
  const apl = r.response.directives?.find((d: any) => d.type === "Alexa.Presentation.APL.RenderDocument");
  assert.ok(apl, "APL card rendered");
  const items = apl.datasources.payload.card.items.map((i: any) => `${i.item}:${i.status}`);
  assert.deepEqual(items, ["Primary care:booked", "OB-GYN:booked", "Gastroenterology:booked_earlier", "Dermatology:booked", "Lab work:may_need_order"]);
  assert.equal(apl.document.type, "APL");
});

test("the same request on a speaker without a screen: voice only", async () => {
  const skill = buildSkill({ innetwork: connectInNetwork({ url: srv.url, token: "innet-sandbox-skill-home" }) });
  const r: any = await skill.invoke(envelope({ type: "IntentRequest", intent: { name: "CheckupStatusIntent", confirmationStatus: "NONE" } }, false, "s-2") as never);
  assert.equal(speech(r), "Four booked. Lab work comes after Tuesday's visit.");
  assert.ok(!r.response.directives?.length);
});

test("a new household: consent first, then 'allow'", async () => {
  const skill = buildSkill({ innetwork: connectInNetwork({ url: srv.url, token: "innet-sandbox-skill-new" }) });
  const r1: any = await skill.invoke(envelope({ type: "LaunchRequest" }, true, "s-3") as never);
  assert.match(speech(r1), /^Before I look anything up, I need your OK\. Say allow to continue\.$/);
  const r2: any = await skill.invoke(envelope({ type: "IntentRequest", intent: { name: "AllowIntent", confirmationStatus: "NONE" } }, true, "s-3") as never);
  assert.equal(speech(r2), "Zero booked. Lab work comes after your primary care visit.");
});

test("the server is down: a short apology inside Alexa's deadline", async () => {
  const skill = buildSkill({ innetwork: connectInNetwork({ url: "http://127.0.0.1:9/mcp", token: "innet-sandbox-x", timeoutMs: 1500 }) });
  const t0 = Date.now();
  const r: any = await skill.invoke(envelope({ type: "LaunchRequest" }, true, "s-4") as never);
  assert.ok(Date.now() - t0 < 6000);
  assert.match(speech(r), /^InNetwork (didn't answer in time|had a problem)/);
});

test("endpoint: an unsigned request is rejected before the skill runs; the same request passes only with verification off", async () => {
  const { startSkillEndpoint } = await import("../src/endpoint.ts");
  const on = await startSkillEndpoint({ port: 0, mcpUrl: srv.url, household: "skill-home" });
  const off = await startSkillEndpoint({ port: 0, mcpUrl: srv.url, household: "skill-home", verify: false });
  try {
    const body = JSON.stringify(envelope({ type: "LaunchRequest" }, true, "s-5"));
    const a = await fetch(on.url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    assert.equal(a.status, 400);
    const forged = await fetch(on.url, { method: "POST", headers: { "Content-Type": "application/json", SignatureCertChainUrl: "https://evil.example/cert.pem", "Signature-256": "AAAA" }, body });
    assert.equal(forged.status, 400);
    const b = await fetch(off.url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    assert.equal(b.status, 200);
    assert.match(JSON.stringify(await b.json()), /Four booked/);
  } finally { await on.close(); await off.close(); }
});

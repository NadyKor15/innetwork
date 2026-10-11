// End-to-end tool tests through a real MCP client over Streamable HTTP (2025-11-25 sessions), against the test double
// directory. Walks the demo story (SPEC §2) and checks the refusals that live in the server (N2, N4, N6, N10, N12, N13)
// plus the office-policy mechanism.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { devDirectory, DEV_POLICIES } from "./dev-directory.ts";
import { forbiddenKeys } from "./store.ts";

const DATA = mkdtempSync(join(tmpdir(), "innetwork-test-"));
process.env.INNETWORK_DATA_DIR = DATA;
const SEED = join(DATA, "policies-seed.json");
writeFileSync(SEED, JSON.stringify(DEV_POLICIES));

const { startMcpServer } = await import("./server.ts");
const { createServices } = await import("./services.ts");
type Running = Awaited<ReturnType<typeof startMcpServer>>;
let srv: Running;

before(async () => {
  const services = await createServices({ directory: devDirectory() });
  services.policiesSeed = SEED;
  srv = await startMcpServer({ port: 0, quiet: true, services });
});
after(async () => { await srv.close(); rmSync(DATA, { recursive: true, force: true }); });

async function connect(user: string) {
  const client = new Client({ name: "test-host", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(srv.url), { requestInit: { headers: { Authorization: `Bearer innet-sandbox-${user}` } } });
  await client.connect(transport);
  return { client, transport, call: async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; structuredContent: Record<string, any>; isError?: boolean; _meta?: { steps: any[] } } };
}

const OPENING = { requests: [
  { member: "Mom", specialty: "gastroenterology" },
  { member: "Older child", specialty: "allergy", age_for_this_search: "5" },
  { member: "Youngest", specialty: "orthopedics", age_for_this_search: "under 2" },
] };

test("N6: nothing is looked up before consent; consent card first", async () => {
  const { call, client } = await connect("u-consent");
  const r = await call("find_in_network", OPENING);
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.data.consentRequired, true);
  assert.equal(r.structuredContent.card.view, "consent");
  assert.ok(!r._meta?.steps.some((s) => s.op.includes("ZIP")), "no directory call before consent");
  const show = await call("consent", { action: "show" });
  assert.match(show.content[0].text, /not a substitute for professional medical advice/);
  await client.close();
});

test("demo story: opening for three people -> book -> checkup plan -> book -> new session -> status -> set aside", async () => {
  const user = "u-story";
  let s = await connect(user);
  await s.call("consent", { action: "allow" });

  // Opening (0:00-0:18)
  const open = await s.call("find_in_network", OPENING);
  assert.equal(open.structuredContent.speech, "One doctor each, in their own plan. Book all three?");
  const rows = open.structuredContent.card.rows;
  assert.deepEqual(rows.map((r: any) => [r.memberLabel, r.planLabel, r.specialty, r.fit.name, r.fit.when]), [
    ["Mom", "Plan A", "Gastroenterology", "Dr. Marisol Venterra", "Thu Oct 22 · 9:15 AM"],
    ["Older child", "Plan B", "Allergy", "Dr. Ansel Quillfeather", "Wed Oct 21 · 2:30 PM"],
    ["Youngest", "Plan C", "Orthopedics", "Dr. Imogen Pellworth", "Mon Oct 19 · 1:30 PM"],
  ]);
  assert.equal(rows[1].fit.note, "great with kids");
  assert.deepEqual(rows[2].setAside, [{ name: "Dr. Tobias Wrenfield", reason: "Doesn't see children under 3" }, { name: "Dr. Caspian Ardley", reason: "Not in his plan's network" }]);
  assert.equal(rows[0].fit.detail, "in Plan A's network · accepting new patients");
  assert.equal(rows[2].fit.detail, "in Plan C's network · sees this age");
  assert.equal(rows[2].ageLabel, "under 2");
  const n4 = () => { const f = JSON.parse(readFileSync(join(DATA, "users", `${user}.json`), "utf8")); assert.deepEqual(forbiddenKeys(f), []); assert.ok(!/under 2|under two|"5"/.test(JSON.stringify(f.pending ?? {})), "age band not in pending"); };
  n4(); // N4 holds while the proposal waits for a yes, not only at the end
  const booked = await s.call("book_visit", { confirm: true });
  assert.equal(booked.structuredContent.speech, "Booked.");
  assert.equal(booked.structuredContent.card.booked, true);

  // Scene 1: checkup year
  const plan = await s.call("checkup_year", { action: "plan", items: ["primary_care", "ob_gyn", "dermatology", "gastroenterology", "lab_work"], oop_met: true });
  assert.deepEqual(plan.structuredContent.speechParts, [
    "After the out-of-pocket max, plans usually pay 100% of covered in-network care until the plan year ends — per HealthCare.gov.",
    "Your gastroenterologist is already booked for Thursday. Tuesday, same clinic: primary care, then OB-GYN. Friday: dermatology. All between 8:30 and 11, while he's at daycare. Lab work may need an order — I'll add it after primary care. Book these three?",
  ]);
  const card = plan.structuredContent.card;
  assert.equal(card.title, "Your visits before Dec 31");
  assert.deepEqual(card.doctors.map((d: any) => [d.specialty, d.name, d.when, d.tag]), [
    ["Primary care", "Dr. Rowena Thistlewood", "Tue Oct 20 · 9:00 AM", "same clinic"],
    ["OB-GYN", "Dr. Linnea Marchbank", "Tue Oct 20 · 10:15 AM", "same clinic"],
    ["Gastroenterology", "Dr. Marisol Venterra", "Thu Oct 22 · 9:15 AM", "Already booked"],
    ["Dermatology", "Dr. Ottilie Brennagh", "Fri Oct 23 · 9:30 AM", null],
  ]);
  assert.equal(card.week.window.label, "8:30–11:15 · while he's at daycare");
  assert.deepEqual(card.week.days.map((d: any) => d.key), ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"], "the week of the visits, not of the sandbox clock");
  assert.deepEqual(card.week.visits.filter((v: any) => v.state === "proposed").map((v: any) => [v.dayKey, v.start, v.label]), [["2026-10-20", "09:00", "Primary care"], ["2026-10-20", "10:15", "OB-GYN"], ["2026-10-23", "09:30", "Dermatology"]]);
  assert.equal(card.lab, "Lab work — may need an order from your doctor · after your primary care visit");
  assert.equal(card.prompt, 'Say "yes" to book these three');
  const kids = card.week.visits.filter((v: any) => v.state === "other_member").map((v: any) => [v.dayKey, v.start, v.label]);
  assert.deepEqual(kids.sort(), [["2026-10-19", "13:30", "Youngest · Orthopedics"], ["2026-10-21", "14:30", "Older child · Allergy"]]);
  const b2 = await s.call("book_visit", { confirm: true });
  assert.equal(b2.structuredContent.speech, "Booked. Details in your Alexa app and email. Say cancel anytime.");
  assert.equal(b2.structuredContent.card.title, "Booked · 3 visits");
  assert.equal(b2.structuredContent.card.subtitle, "All between 8:30 and 11, while he's at daycare");
  assert.equal(b2.structuredContent.card.week.days[0].key, "2026-10-19");
  assert.deepEqual(b2.structuredContent.card.list.map((l: any) => [l.when, l.label, l.earlier]), [
    ["Tue Oct 20 · 9:00 AM", "Primary care", false], ["Tue Oct 20 · 10:15 AM", "OB-GYN", false], ["Fri Oct 23 · 9:30 AM", "Dermatology", false], ["Thu Oct 22 · 9:15 AM", "Gastroenterology", true],
  ]);

  // New session: state lives on the server
  await s.transport.terminateSession(); await s.client.close();
  s = await connect(user);
  const st = await s.call("checkup_year", { action: "status" });
  assert.equal(st.structuredContent.speech, "Four booked. Lab work comes after Tuesday's visit.");
  assert.deepEqual(st.structuredContent.card.items.map((i: any) => [i.item, i.status, i.text, i.detail]), [
    ["Primary care", "booked", "Booked Tue Oct 20", null], ["OB-GYN", "booked", "Booked Tue Oct 20", null],
    ["Gastroenterology", "booked_earlier", "Booked Thu Oct 22", "booked earlier"], ["Dermatology", "booked", "Booked Fri Oct 23", null],
    ["Lab work", "may_need_order", "May need an order", "after your primary care visit"],
  ]);
  assert.match(st.structuredContent.card.subtitle, /^Out-of-pocket max met · plans usually pay 100% of covered in-network care until Dec 31$/);

  // N10: lab work refused before the primary care visit
  const lab = await s.call("book_visit", { item: "lab_work", confirm: true });
  assert.equal(lab.isError, true);
  assert.equal(lab.structuredContent.data.refused, "N10");

  // Scene 2: the youngest's full search
  const aside = await s.call("find_in_network", { requests: [{ member: "my youngest", specialty: "orthopedics", age_for_this_search: "under two" }] });
  assert.equal(aside.structuredContent.speech, "I checked six nearby. Two don't see children under three, one isn't in his plan. These two fit.");
  const c = aside.structuredContent.card;
  assert.equal(c.view, "set-aside");
  assert.deepEqual(c.heading, { member: "youngest", specialty: "Orthopedics", forWhom: "for your youngest (under 2)", plan: "on Plan C" });
  assert.deepEqual(c.fits.map((f: any) => [f.name, f.specialtyLabel, f.checks, f.when, f.booked]), [
    ["Dr. Imogen Pellworth", "Pediatric orthopedics", ["in Plan C's network", "sees this age"], "Mon Oct 19 · 1:30 PM", true],
    ["Dr. Corwin Pembrook", "Orthopedics", ["in Plan C's network", "sees this age"], "Tue Oct 20 · 2:00 PM", false],
  ]);
  assert.deepEqual(c.setAside.map((x: any) => [x.name, x.reason]), [
    ["Dr. Tobias Wrenfield", "Doesn't see children under 3"], ["Dr. Percival Ashgrove", "Doesn't see children under 3"],
    ["Dr. Caspian Ardley", "Not in his plan's network"], ["Dr. Wendeline Hartsworth", "Age not listed · we'll ask the office when booking"],
  ]);
  assert.equal(c.footer, "Age used for this search only · not saved");
  n4();
  await s.client.close();

  // N4: the household file holds no ages, names, dates of birth or program types
  const file = JSON.parse(readFileSync(join(DATA, "users", `${user}.json`), "utf8"));
  assert.deepEqual(forbiddenKeys(file), []);
  assert.ok(!JSON.stringify(file).includes("under 2") && !JSON.stringify(file).includes("under two"), "the age band said in a search is not stored");
  assert.equal(file.outbox.length, 4, "two bookings x (Alexa app card + email)");
});

test("N4 mutation guard: the key scanner catches an age field", () => {
  assert.deepEqual(forbiddenKeys({ family: [{ label: "Youngest", ageBand: "under 2" }] }), ["$.family[0].ageBand"]);
  assert.deepEqual(forbiddenKeys({ family: [{ label: "Youngest", programType: "Medicaid" }] }), ["$.family[0].programType"]);
});

test("N12: a time over the routine needs an explicit yes", async () => {
  const s = await connect("u-routine");
  await s.call("consent", { action: "allow" });
  // Only slot left for this doctor in the test: make the routine cover every afternoon gap so the slot is over it.
  await s.call("family_routine", { action: "set", blocks: [{ label: "Daycare drop-off", days: [1, 2, 3, 4, 5], start: "07:50", end: "08:15" }, { label: "Nap time", days: [1, 2, 3, 4, 5], start: "12:00", end: "17:00", for_member: "Youngest" }] });
  const r = await s.call("find_in_network", { requests: [{ member: "Youngest", specialty: "orthopedics", age_for_this_search: "under 2" }] });
  assert.ok(r.structuredContent.data.proposal, "a proposal exists");
  const b = await s.call("book_visit", { confirm: true });
  if (b.structuredContent.data.refused) {
    assert.equal(b.structuredContent.data.refused, "N12");
    assert.match(b.content[0].text, /^That's during .+\. Book it anyway\?$/);
    const ok = await s.call("book_visit", { confirm: true, book_over_routine: true });
    assert.equal(ok.isError, undefined);
  } else {
    assert.fail("expected N12 refusal before booking over the routine");
  }
  await s.client.close();
});

test("N13-notes-private: a note of one family is not visible to another and never enters office policies", async () => {
  const a = await connect("u-notes-a");
  await a.call("consent", { action: "allow" });
  await a.call("doctor_notes", { action: "add", doctor: "Dr. Corwin Pembrook", text: "kind but always late" });
  const b = await connect("u-notes-b");
  await b.call("consent", { action: "allow" });
  const bn = await b.call("doctor_notes", { action: "list" });
  assert.ok(!JSON.stringify(bn).includes("always late"));
  const br = await b.call("find_in_network", { requests: [{ member: "Youngest", specialty: "orthopedics", age_for_this_search: "under 2" }] });
  assert.ok(!JSON.stringify(br).includes("always late"));
  const policies = readFileSync(join(DATA, "office-policies.json"), "utf8");
  assert.ok(!policies.includes("always late") && !policies.includes("great with kids"));
  // notes never reorder results: family A (with a note on Pembrook) sees the same order as family B
  const ar = await a.call("find_in_network", { requests: [{ member: "Youngest", specialty: "orthopedics", age_for_this_search: "under 2" }] });
  assert.deepEqual(ar.structuredContent.card.fits.map((f: any) => f.name), br.structuredContent.card.fits.map((f: any) => f.name));
  await a.client.close(); await b.client.close();
});

test("office policy learned at a booking spares the next family the call (no family data stored)", async () => {
  const before = JSON.parse(readFileSync(join(DATA, "office-policies.json"), "utf8")) as { officeId: string }[];
  assert.ok(!before.some((p) => p.officeId === "ortho-6"));
  // family 1 books the "age not listed" doctor directly through a proposal limited to her
  const s = await connect("u-learn-1");
  await s.call("consent", { action: "allow" });
  const { loadUser, saveUser } = await import("./store.ts");
  const { loadScenario } = await import("./scenario.ts");
  const sc = loadScenario();
  const u = loadUser("u-learn-1", () => { throw new Error("must exist"); });
  u.pending = { kind: "book", from: "find_in_network", at: sc.now, proposals: [{ memberId: "m3", item: "orthopedics", recordId: "t:ortho-6", doctorName: "Dr. Wendeline Hartsworth", specialtyLabel: "Orthopedics", officeId: "ortho-6", officeName: "Office ortho-6", distanceMi: 2.7, start: sc.slotsFor("Dr. Wendeline Hartsworth")[0].start, end: sc.slotsFor("Dr. Wendeline Hartsworth")[0].end, networkStatus: "in_network", overRoutine: null }] };
  saveUser(u);
  const b = await s.call("book_visit", { confirm: true });
  assert.ok(b._meta!.steps.some((x) => x.service === "Office age policies"));
  const after = JSON.parse(readFileSync(join(DATA, "office-policies.json"), "utf8")) as Record<string, unknown>[];
  const learned = after.find((p) => p.officeId === "ortho-6")!;
  assert.deepEqual(Object.keys(learned).sort(), ["demo", "learnedAt", "maxAgeMonths", "minAgeMonths", "officeId", "source"]);
  // family 2 now sees her as "sees this age" without asking the office
  const t = await connect("u-learn-2");
  await t.call("consent", { action: "allow" });
  const r = await t.call("find_in_network", { requests: [{ member: "Youngest", specialty: "orthopedics", age_for_this_search: "under 2" }] });
  assert.ok(r.structuredContent.card.fits.some((f: any) => f.name === "Dr. Wendeline Hartsworth"));
  await s.client.close(); await t.client.close();
});

test("N8: a directory that does not answer is 'not confirmed', never a fit", async () => {
  const { buildMcpServer } = await import("./tools.ts");
  const services = await createServices({ directory: devDirectory({ failFor: ["plan-c"] }) });
  services.policiesSeed = SEED;
  const local = await startMcpServer({ port: 0, quiet: true, services });
  try {
    const client = new Client({ name: "t", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(local.url), { requestInit: { headers: { Authorization: "Bearer innet-sandbox-u-n8" } } }));
    await client.callTool({ name: "consent", arguments: { action: "allow" } });
    const r = (await client.callTool({ name: "find_in_network", arguments: OPENING })) as any;
    const youngest = r.structuredContent.card.rows[2];
    assert.equal(youngest.fit, null);
    assert.equal(youngest.none, "Not confirmed — directory didn't answer");
    assert.ok(r._meta.steps.some((x: any) => /did not answer/.test(x.summary)));
    await client.close();
    void buildMcpServer;
  } finally { await local.close(); }
});

test("inputs: no symptoms field, specialty from the closed list only (N1)", async () => {
  const s = await connect("u-inputs");
  await s.call("consent", { action: "allow" });
  const bad1 = await s.call("find_in_network", { requests: [{ member: "Mom", specialty: "gastroenterology", symptoms: "stomach ache" }] });
  assert.equal(bad1.isError, true);
  const bad2 = await s.call("find_in_network", { requests: [{ member: "Mom", specialty: "whatever helps" }] });
  assert.equal(bad2.isError, true);
  await s.client.close();
  assert.ok(readdirSync(join(DATA, "users")).length > 0);
});

test("N11: a live directory record (a real doctor) never gets slots, an age policy or a booking", async () => {
  const base = devDirectory();
  const live = {
    ...base, mode: "live" as const,
    async lookup(plan: any, specialty: any, zip: string) {
      const a = await base.lookup(plan, specialty, zip);
      if (!a.ok) return a;
      return { ...a, mode: "live" as const, records: a.records.map((r) => ({ ...r, source: { ...r.source, mode: "live" as const, provenance: undefined } })) };
    },
  };
  const services = await createServices({ directory: live });
  services.policiesSeed = SEED;
  const local = await startMcpServer({ port: 0, quiet: true, services });
  try {
    const client = new Client({ name: "t", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(local.url), { requestInit: { headers: { Authorization: "Bearer innet-sandbox-u-n11" } } }));
    await client.callTool({ name: "consent", arguments: { action: "allow" } });
    const adult = (await client.callTool({ name: "find_in_network", arguments: { requests: [{ member: "Mom", specialty: "gastroenterology" }] } })) as any;
    assert.ok(adult.structuredContent.card.fits.length >= 1, "a real in-network doctor is shown");
    assert.equal(adult.structuredContent.data.proposal, null, "no proposal for real doctors");
    assert.ok(adult.structuredContent.card.fits.every((f: any) => f.when === null), "no times for real doctors");
    const r = (await client.callTool({ name: "find_in_network", arguments: { requests: [{ member: "Youngest", specialty: "orthopedics", age_for_this_search: "under 2" }] } })) as any;
    // the demo office policies are never matched to live records: no "Doesn't see children under 3" on a real doctor
    assert.ok(!JSON.stringify(r.structuredContent.card).includes("Doesn't see children"));
    const b = (await client.callTool({ name: "book_visit", arguments: { confirm: true } })) as any;
    assert.equal(b.isError, true);
    await client.close();
  } finally { await local.close(); }
});

test("N2: an out-of-network proposal is booked only after a second explicit yes", async () => {
  const s = await connect("u-n2");
  await s.call("consent", { action: "allow" });
  const { loadUser, saveUser } = await import("./store.ts");
  const { loadScenario } = await import("./scenario.ts");
  const sc = loadScenario();
  const u = loadUser("u-n2", () => { throw new Error("must exist"); });
  const slot = sc.slotsFor("Dr. Caspian Ardley")[0];
  u.pending = { kind: "book", from: "find_in_network", at: sc.now, proposals: [{ memberId: "m3", item: "orthopedics", recordId: "t:ortho-5", doctorName: "Dr. Caspian Ardley", specialtyLabel: "Orthopedics", officeId: "ortho-5", officeName: "Office ortho-5", distanceMi: 1.5, start: slot.start, end: slot.end, networkStatus: "out_of_network", overRoutine: null }] };
  saveUser(u);
  const first = await s.call("book_visit", { confirm: true });
  assert.equal(first.isError, true);
  assert.equal(first.structuredContent.data.refused, "N2");
  assert.equal(first.content[0].text, "That doctor is out of network for his plan. Book anyway?");
  const second = await s.call("book_visit", { confirm: true, book_anyway: true });
  assert.equal(second.isError, undefined);
  const after = loadUser("u-n2", () => { throw new Error("must exist"); });
  assert.equal(after.visits.at(-1)!.outOfNetworkConfirmed, true);
  await s.client.close();
});

test("N13: an office policy keeps only its six fields, whatever the caller passes", async () => {
  const { savePolicy } = await import("./store.ts");
  savePolicy({ officeId: "x-office", minAgeMonths: 12, maxAgeMonths: null, source: "office_confirmed_at_booking", learnedAt: "2026-10-16", demo: true, note: "great with kids", memberId: "m3", family: "u-1" } as never, SEED);
  const all = JSON.parse(readFileSync(join(DATA, "office-policies.json"), "utf8")) as Record<string, unknown>[];
  const p = all.find((x) => x.officeId === "x-office")!;
  assert.deepEqual(Object.keys(p).sort(), ["demo", "learnedAt", "maxAgeMonths", "minAgeMonths", "officeId", "source"]);
});

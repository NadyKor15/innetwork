// Directory adapters: offline tests on the recorded samples and on synthetic directory answers (no real names),
// the three modes, and "directory didn't answer -> ok:false" (N8) with a fetch double. Live tests run only with LIVE=1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDirectory, writeCache } from "./index.ts";
import { loadFixture, FIXTURE_DIR } from "./fixtures.ts";
import { _resetNetworkIndexCache } from "./florida-blue.ts";
import { PLANS } from "./plans.ts";
import { isSpecialty, specialtyLabel } from "./specialties.ts";
import { normalizeRole } from "../../packages/plannet-directory-check/src/records.ts";
import { molinaToRecord } from "./molina.ts";
import { qhpAccepting, qhpToRecords } from "./qhp-file.ts";
import type { FetchLike } from "../../packages/plannet-directory-check/src/http.ts";
import type { DirectoryRecord, Specialty } from "../core/types.ts";

const plan = (id: string) => PLANS.find((p) => p.planId === id)!;
const DEMO_CAST: Record<string, string[]> = {
  "plan-a.primary_care": ["Dr. Rowena Thistlewood"],
  "plan-a.ob_gyn": ["Dr. Linnea Marchbank"],
  "plan-a.gastroenterology": ["Dr. Marisol Venterra"],
  "plan-a.dermatology": ["Dr. Ottilie Brennagh"],
  "plan-b.allergy": ["Dr. Ansel Quillfeather"],
  "plan-c.orthopedics": ["Dr. Caspian Ardley", "Dr. Corwin Pembrook", "Dr. Imogen Pellworth", "Dr. Percival Ashgrove", "Dr. Tobias Wrenfield", "Dr. Wendeline Hartsworth"],
};

const inPlan = (r: DirectoryRecord, planId: string) => r.networks.some((n) => plan(planId).networkIds.includes(n));

test("recorded samples: the demo cast, exactly the brief's names, normalized by the live code path", () => {
  for (const [key, names] of Object.entries(DEMO_CAST)) {
    const [planId, specialty] = key.split(".") as [string, Specialty];
    const fx = loadFixture(planId, specialty);
    assert.ok(fx, `fixture ${key} exists`);
    assert.deepEqual(fx.records.map((r) => r.name).sort(), [...names].sort(), key);
    for (const r of fx.records) {
      assert.equal(r.source.mode, "fixture");
      assert.match(r.source.provenance ?? "", /^(directory record|plan file) captured Oct (11|13), names(, offices and specialty| and offices) changed$/);
      assert.ok(r.recordId.startsWith(`fx:${planId}:`), r.recordId);
      assert.ok(r.officeId.startsWith("fx:office:"), r.officeId);
      assert.ok(r.npi === null || /^0\d{9}$/.test(r.npi), `fixture NPI is impossible (starts with 0): ${r.npi}`);
      assert.equal(typeof r.distanceMi, "number");
      assert.equal(r.specialty, specialty);
    }
  }
});

test("recorded samples: same clinic for primary care and OB-GYN; network membership as in the brief", () => {
  const pcp = loadFixture("plan-a", "primary_care")!.records[0];
  const ob = loadFixture("plan-a", "ob_gyn")!.records[0];
  assert.equal(pcp.officeId, ob.officeId, "Thistlewood and Marchbank share one office");
  assert.equal(pcp.distanceMi, 2.1);
  for (const s of ["primary_care", "ob_gyn", "gastroenterology", "dermatology"] as Specialty[]) {
    const r = loadFixture("plan-a", s)!.records[0];
    assert.ok(inPlan(r, "plan-a"), `${r.name} in Plan A's network`);
    assert.equal(r.newPatients, "accepting");
  }
  assert.ok(inPlan(loadFixture("plan-b", "allergy")!.records[0], "plan-b"));
  const c = loadFixture("plan-c", "orthopedics")!.records;
  const byName = new Map(c.map((r) => [r.name, r]));
  for (const n of ["Dr. Imogen Pellworth", "Dr. Corwin Pembrook", "Dr. Tobias Wrenfield", "Dr. Percival Ashgrove", "Dr. Wendeline Hartsworth"]) assert.ok(inPlan(byName.get(n)!, "plan-c"), `${n} in Plan C`);
  assert.ok(!inPlan(byName.get("Dr. Caspian Ardley")!, "plan-c"), "Ardley is NOT in Plan C's network");
  assert.ok(byName.get("Dr. Caspian Ardley")!.networks.length > 0, "Ardley is in another network (as captured)");
});

test("recorded samples carry no 'checked today', no stars, and their meta says what changed", () => {
  for (const f of readdirSync(FIXTURE_DIR).filter((x) => x.endsWith(".json"))) {
    const t = readFileSync(join(FIXTURE_DIR, f), "utf8");
    assert.ok(!/checked today|★|demo reviews|Maya Lin|Sam Ruiz/i.test(t), f);
    if (f.endsWith(".meta.json")) {
      const m = JSON.parse(t);
      assert.ok(m.capturedAt && m.source?.request && m.changed?.length && m.provenance, `${f} has capturedAt, request, changed, provenance`);
    }
  }
});

test("office policies seed: office + age range + source + date only, demo:true, offices exist in the samples", () => {
  const pol = JSON.parse(readFileSync(join(FIXTURE_DIR, "..", "office-policies.json"), "utf8")) as Record<string, unknown>[];
  const offices = new Set(Object.keys(DEMO_CAST).flatMap((k) => { const [p, s] = k.split("."); return loadFixture(p, s as Specialty)!.records.map((r) => r.officeId); }));
  for (const p of pol) {
    assert.deepEqual(Object.keys(p).sort(), ["demo", "learnedAt", "maxAgeMonths", "minAgeMonths", "officeId", "source"]);
    assert.equal(p.demo, true);
    assert.ok(offices.has(p.officeId as string), `${p.officeId} is a fixture office`);
  }
  const c = loadFixture("plan-c", "orthopedics")!.records;
  const office = (n: string) => c.find((r) => r.name === n)!.officeId;
  const min = (o: string) => pol.find((p) => p.officeId === o)?.minAgeMonths;
  assert.equal(min(office("Dr. Tobias Wrenfield")), 36);
  assert.equal(min(office("Dr. Percival Ashgrove")), 36);
  assert.equal(pol.find((p) => p.officeId === office("Dr. Wendeline Hartsworth")), undefined, "Hartsworth: no policy -> age not listed");
});

// ---- synthetic directory answers (structure as the real ones, invented values) -----------------------------------

const FB_BASE = "https://apigw.bcbsfl.com/interop/interop-developer-portal/emr/api/v1/fhir";
const synthRole = (id: string, net: string, text: string, locs: string[]) => ({
  resourceType: "PractitionerRole", id,
  extension: [
    { url: "http://hl7.org/fhir/us/davinci-pdex-plan-net/StructureDefinition/newpatients", extension: [{ url: "acceptingPatients", valueCodeableConcept: { coding: [{ code: "newpt" }] } }] },
    { url: "http://hl7.org/fhir/us/davinci-pdex-plan-net/StructureDefinition/network-reference", valueReference: { reference: net } },
  ],
  identifier: [{ system: "http://hl7.org/fhir/sid/us-npi", value: `09000000${id.slice(-2).padStart(2, "0")}` }, { system: "https://www.edifecs.com/fhir/cms-organization/plan_id", value: "BCHPPO" }],
  practitioner: { reference: `Practitioner/p${id}` },
  specialty: [{ coding: [{ code: "UNK" }], text }],
  location: locs.map((l) => ({ reference: `Location/${l}` })),
});
const synthLoc = (id: string, zip: string) => ({ resourceType: "Location", id, name: `${id} SAMPLE ST`, address: { line: [`${id} SAMPLE ST`], city: "ORLANDO", state: "FL", postalCode: zip } });
const synthPrac = (id: string) => ({ resourceType: "Practitioner", id: `p${id}`, name: [{ text: "TESTA PERSONA", given: ["TESTA"], family: "PERSONA" }] });

function fbDouble(opts: { fail?: "network" | "500" | "outcome" } = {}): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/fhir+json" } });
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    if (opts.fail === "network") throw new TypeError("fetch failed");
    if (opts.fail === "500") return json({ httpCode: "500" }, 500);
    if (opts.fail === "outcome") return json({ resourceType: "OperationOutcome", issue: [{ severity: "error", diagnostics: "Unknown search parameter" }] });
    if (url.includes("/Organization?")) return json({ resourceType: "Bundle", entry: [{ resource: { resourceType: "Organization", id: "900", identifier: [{ use: "official", value: "PPC-2026-BCHPPO" }] } }, { resource: { resourceType: "Organization", id: "901", identifier: [{ use: "official", value: "NWB-2026-OTHER" }] } }] });
    if (url.includes("/PractitionerRole?")) {
      return json({ resourceType: "Bundle", entry: [
        { search: { mode: "match" }, resource: synthRole("r01", "Organization/900", "DERMATOLOGY", ["l1", "l2"]) },
        { search: { mode: "match" }, resource: synthRole("r02", "Organization/900", "DERMATOLOGY", ["l1"]) },
        { search: { mode: "match" }, resource: synthRole("r03", "Organization/901", "DERMATOLOGY", ["l1"]) },
        { search: { mode: "match" }, resource: synthRole("r04", "Organization/900", "DERMATOLOGY SURGERY CENTER NOT", ["l1"]) },
        { search: { mode: "include" }, resource: synthLoc("l1", "32801") },
        { search: { mode: "include" }, resource: synthLoc("l2", "33601") },
        { search: { mode: "include" }, resource: synthPrac("r01") },
      ] });
    }
    return json({ resourceType: "Bundle", entry: [] });
  };
  return { fetch, calls };
}

test("Florida Blue normalization (synthetic answer): network id resolved, location inside the ZIP, directory fields only", async () => {
  _resetNetworkIndexCache();
  const { fetch, calls } = fbDouble();
  const d = createDirectory({ mode: "live", fetchImpl: fetch, cacheDir: mkdtempSync(join(tmpdir(), "dircache-")) });
  const a = await d.lookup(plan("plan-a"), "dermatology", "32801");
  assert.equal(a.ok, true);
  if (!a.ok) return;
  assert.equal(a.mode, "live");
  const r1 = a.records.find((r) => r.recordId === "fb:PractitionerRole/r01")!;
  assert.equal(r1.name, "Dr. Testa Persona");
  assert.deepEqual(r1.networks, ["PPC-2026-BCHPPO"]);
  assert.equal(r1.address.zip, "32801", "the role's location inside the searched ZIP, not its other one");
  assert.equal(r1.officeId, "fb:Location/l1");
  assert.equal(r1.newPatients, "accepting");
  assert.equal(r1.source.provenance, undefined, "live records carry no fixture provenance");
  assert.equal(a.inNetworkCount, 3, "r01, r02, r04 carry the plan's network; r03 does not");
  assert.ok(calls.some((u) => u.includes("location.address-postalcode=32801") && u.includes("BCHPPO") && u.includes("specialty%3Atext=DERMATOLOGY")), "server-side chain + plan + specialty");
});

test("N8: directory didn't answer -> ok:false (network error, HTTP 500, OperationOutcome), never a throw", async () => {
  for (const fail of ["network", "500", "outcome"] as const) {
    _resetNetworkIndexCache();
    const d = createDirectory({ mode: "live", fetchImpl: fbDouble({ fail }).fetch, cacheDir: mkdtempSync(join(tmpdir(), "dircache-")) });
    const a = await d.lookup(plan("plan-a"), "dermatology", "32801");
    assert.equal(a.ok, false, fail);
    if (!a.ok) assert.ok(a.error.length > 0);
    const auto = createDirectory({ mode: "auto", fetchImpl: fbDouble({ fail }).fetch });
    const p = await auto.probe!(plan("plan-a"), "dermatology", "32801");
    assert.ok(p && p.ok === false && p.error.length > 0, `probe ${fail} -> ok:false`);
  }
});

test("N8: a hung directory times out into ok:false within the timeout", async () => {
  _resetNetworkIndexCache();
  const hang: FetchLike = (_url, init) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
  const d = createDirectory({ mode: "auto", fetchImpl: hang, timeoutMs: 150 });
  const t0 = Date.now();
  const p = await d.probe!(plan("plan-a"), "dermatology", "32801");
  assert.ok(p && p.ok === false && /timeout/.test(p.error), JSON.stringify(p));
  assert.ok(Date.now() - t0 < 2000);
});

test("modes: fixture = samples + no probe; auto = samples + live probe; live = live records", async () => {
  _resetNetworkIndexCache();
  const fx = createDirectory({ mode: "fixture" });
  assert.equal(fx.mode, "fixture");
  const a = await fx.lookup(plan("plan-c"), "orthopedics", "32801");
  assert.ok(a.ok && a.records.length === 6 && a.records.every((r) => r.source.mode === "fixture"));
  assert.equal(await fx.probe!(plan("plan-a"), "dermatology", "32801"), null);
  const other = await fx.lookup(plan("plan-c"), "orthopedics", "33601");
  assert.ok(other.ok && other.records.length === 0, "no recorded sample outside the demo area");

  const { fetch } = fbDouble();
  const auto = createDirectory({ mode: "auto", fetchImpl: fetch });
  const b = await auto.lookup(plan("plan-a"), "dermatology", "32801");
  assert.ok(b.ok && b.records.every((r) => r.source.mode === "fixture"), "auto: cards from the sample");
  const p = await auto.probe!(plan("plan-a"), "dermatology", "32801");
  assert.ok(p && p.ok && p.inNetworkCount === 3 && p.mode === "live", JSON.stringify(p));
  assert.equal(await auto.probe!(plan("plan-b"), "allergy", "32801"), null, "marketplace plan: files, no live API");
});

test("live Plan B: never streams inside a turn; answers from the warm cache or says it isn't warmed", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "dircache-"));
  const d = createDirectory({ mode: "live", cacheDir, fetchImpl: async () => { throw new Error("must not fetch"); } });
  const cold = await d.lookup(plan("plan-b"), "allergy", "32801");
  assert.equal(cold.ok, false);
  if (!cold.ok) assert.match(cold.error, /directory:warm/);
  writeCache(cacheDir, "plan-b", "allergy", "32801", { ok: true, records: [], mode: "file", directory: "x", ms: 1, asOf: new Date().toISOString(), ref: "file", inNetworkCount: 0 });
  const warm = await d.lookup(plan("plan-b"), "allergy", "32801");
  assert.ok(warm.ok && /warm cache/.test(warm.ref));
});

test("Molina normalization (synthetic, their shapes): bare network id, newpatients without sub-extension, NPI typed identifier", () => {
  const role = {
    resourceType: "PractitionerRole", id: "m1",
    extension: [
      { url: "http://hl7.org/fhir/us/davinci-pdex-plan-net/StructureDefinition/network-reference", valueReference: { reference: "15", display: "Medicaid-Managed Medical Assistance (MMA)" } },
      { url: "http://hl7.org/fhir/us/davinci-pdex-plan-net/StructureDefinition/newpatients", valueCodeableConcept: { coding: [{ code: "nopt", display: "Not Accepting New Patients" }] } },
      { url: "http://hl7.org/fhir/us/davinci-pdex-plan-net/StructureDefinition/qualification", extension: [{ url: "code", valueCodeableConcept: { coding: [{ code: "207XP3100X", display: "Pediatric Orthopaedic Surgery" }] } }] },
    ],
    identifier: [{ type: { coding: [{ code: "NPI" }] }, value: "0900000099" }],
    practitioner: { reference: "Practitioner/x", display: "Testa Persona" },
    specialty: [{ coding: [{ system: "https://example.invalid/specialties", code: "1", display: "Orthopedic Surgery" }] }],
    location: [{ reference: "Location/l9" }],
  };
  const n = normalizeRole("molina", role, synthLoc("l9", "32806"), null);
  const r = molinaToRecord(n, "orthopedics", "2026-10-11T00:00:00Z", "test");
  assert.deepEqual(r.networks, ["molina:15"]);
  assert.equal(r.newPatients, "not_accepting");
  assert.equal(r.npi, "0900000099");
  assert.equal(r.specialtyLabel, "Pediatric orthopedics");
  assert.ok(isSpecialty("orthopedics", n.specialtyCodes, n.specialtyTexts));
});

test("QHP normalization (synthetic): plan ids are the network; one record per address in the ZIP set; accepting mapping", () => {
  const p = { npi: "0900000098", type: "INDIVIDUAL", name: { first: "Testa", last: "Persona" }, specialty: ["Allergist"], accepting: "accepting in some locations", plans: [{ plan_id: "21525FL0010009" }, { plan_id: "21525FL0010001" }], addresses: [{ address: "1 Sample St", city: "Orlando", state: "FL", zip: "32804-1234" }, { address: "2 Sample St", city: "Tampa", state: "FL", zip: "33601" }] };
  const recs = qhpToRecords(p, "allergy", ["32804"], { asOf: "t", ref: "r", mode: "file" });
  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0].networks, ["21525FL0010009", "21525FL0010001"]);
  assert.equal(recs[0].address.zip, "32804");
  assert.equal(recs[0].newPatients, "unknown", "'accepting in some locations' is not a yes for this office");
  assert.equal(qhpAccepting("not accepting"), "not_accepting");
  assert.equal(specialtyLabel("allergy", [], ["Allergist"]), "Allergist");
});

test("specialty mapping: gastroenterology is never matched by 'INTERNAL MEDICINE' alone (needs the NPPES join)", () => {
  assert.equal(isSpecialty("gastroenterology", [], ["INTERNAL MEDICINE"]), false);
  assert.equal(isSpecialty("gastroenterology", ["207RG0100X"], ["INTERNAL MEDICINE"]), true);
  assert.equal(isSpecialty("primary_care", [], ["FAMILY PRACTICE"]), true);
  assert.equal(isSpecialty("pediatrics", [], ["Pediatric Dentist"]), false);
});

test("Plan C probe: Molina's live answer from directory:warm (own asOf) when fresh; otherwise live, and a failure is ok:false", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "dircache-"));
  const failing: FetchLike = async () => new Response(JSON.stringify({ statusCode: 403, message: "Out of call volume quota." }), { status: 403 });
  const d = createDirectory({ mode: "auto", cacheDir, fetchImpl: failing, molinaDeadlineMs: 2000 });
  const cold = await d.probe!(plan("plan-c"), "orthopedics", "32803");
  assert.ok(cold && cold.ok === false && /403/.test(cold.error), JSON.stringify(cold));
  const asOf = new Date(Date.now() - 3600_000).toISOString();
  writeCache(cacheDir, "plan-c", "orthopedics", "32803", { ok: true, records: [], mode: "live", directory: "Molina", ms: 41000, asOf, ref: "molina sweep", inNetworkCount: 7 });
  const warm = await d.probe!(plan("plan-c"), "orthopedics", "32803");
  assert.ok(warm && warm.ok && warm.inNetworkCount === 7 && warm.asOf === asOf && /warm cache/.test(warm.ref), JSON.stringify(warm));
});

const LIVE = process.env.LIVE === "1";
test("LIVE: Florida Blue answers for Plan A (dermatology, ZIP 32803) with a non-zero in-network count", { skip: !LIVE }, async () => {
  _resetNetworkIndexCache();
  const d = createDirectory({ mode: "auto", timeoutMs: 15000 });
  const p = await d.probe!(plan("plan-a"), "dermatology", "32803");
  assert.ok(p && p.ok && p.inNetworkCount > 0, JSON.stringify(p));
});

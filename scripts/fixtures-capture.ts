// Records the demo's directory samples (fixtures/directory) from REAL directory answers, then anonymizes them.
//
//   node scripts/fixtures-capture.ts            capture + anonymize + self-check
//
// What is real in a fixture: the record's structure, the network reference / plan ids, the newpatients flag, the
// specialty as the directory states it, profile and vendor identifiers' shape. What is replaced: practitioner names
// (by the fictional names of the demo, which passed `npm run guard:names`), gender (to match the fictional name),
// NPI (an impossible number: 10 digits starting with 0), every office (name, street, phone, resource id) by a
// fictional office, the role's other locations, narrative text. Real doctors never get demo slots, age policies or
// notes (SPEC §4.4, N11), which is why the offices are fictional too.
//
// The raw answers (real names) go to audit-private/ (gitignored) and never into the repo. After writing, the script
// checks that none of the raw identifying strings occurs in any fixture, with a must-light control (the same check
// run on the raw file must find them).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Counters } from "../packages/plannet-directory-check/src/http.ts";
import { FhirClient, type FhirResource } from "../packages/plannet-directory-check/src/fhir.ts";
import { rolesInZip, type NormalizedRole } from "../packages/plannet-directory-check/src/records.ts";
import { addressOf } from "../packages/plannet-directory-check/src/plannet.ts";
import { nppesSearch } from "../packages/plannet-directory-check/src/nppes.ts";
import { planIdsOf, streamProviders, zipOf, type QhpProvider } from "../packages/plannet-directory-check/src/qhp.ts";
import { FB, networkIndex } from "../src/directory/florida-blue.ts";
import { MOLINA } from "../src/directory/molina.ts";
import { FLORIDA_BLUE_PLAN_ID_SYSTEM, PLAN_SOURCES } from "../src/directory/plans.ts";
import { isSpecialty } from "../src/directory/specialties.ts";
import type { Specialty } from "../src/core/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "fixtures", "directory");
const PRIVATE = join(ROOT, "audit-private", "captures");
mkdirSync(OUT, { recursive: true });
mkdirSync(PRIVATE, { recursive: true });
const capturedAt = new Date().toISOString();
const DEMO_ZIP = "32801";
const counters = new Counters(true);

// ---- the fictional side (names passed guard:names; offices are invented) ----------------------------------------
type Office = { key: string; name: string; line: string; city: string; zip: string; phone: string };
const OFFICES: Record<string, Office> = {
  A1: { key: "A1", name: "Brightwater Family & Women's Health", line: "1400 Brightwater Ln", city: "Orlando", zip: "32803", phone: "4075550101" },
  A2: { key: "A2", name: "Cypress Fern Digestive Care", line: "2215 Cypress Fern Way", city: "Orlando", zip: "32804", phone: "4075550102" },
  A3: { key: "A3", name: "Juniper Row Dermatology", line: "610 Juniper Row", city: "Orlando", zip: "32806", phone: "4075550103" },
  B1: { key: "B1", name: "Kestrel Point Allergy & Asthma", line: "3120 Kestrel Point Dr", city: "Orlando", zip: "32804", phone: "4075550104" },
  C1: { key: "C1", name: "Little Heron Pediatric Orthopedics", line: "45 Little Heron Ct", city: "Orlando", zip: "32806", phone: "4075550105" },
  C2: { key: "C2", name: "Sawgrass Bend Orthopedics", line: "980 Sawgrass Bend Rd", city: "Orlando", zip: "32803", phone: "4075550106" },
  C3: { key: "C3", name: "Marigold Court Orthopedic Group", line: "1720 Marigold Ct", city: "Orlando", zip: "32801", phone: "4075550107" },
  C4: { key: "C4", name: "Tallow Creek Bone & Joint", line: "2604 Tallow Creek Blvd", city: "Orlando", zip: "32806", phone: "4075550108" },
  C5: { key: "C5", name: "Quarry Lane Orthopedics", line: "455 Quarry Ln", city: "Orlando", zip: "32801", phone: "4075550109" },
  C6: { key: "C6", name: "Foxglove Hill Orthopedics", line: "3300 Foxglove Hill Rd", city: "Orlando", zip: "32804", phone: "4075550110" },
};
type Person = { given: string; family: string; gender: "female" | "male"; office: string; distanceMi: number; npi: string; slot: string };
const P = (given: string, family: string, gender: "female" | "male", office: string, distanceMi: number, n: number): Person =>
  ({ given, family, gender, office, distanceMi, npi: `0${String(900000000 + n)}`, slot: `fx-${office.toLowerCase()}-${family.toLowerCase()}` });

const PEOPLE = {
  thistlewood: P("Rowena", "Thistlewood", "female", "A1", 2.1, 1),
  marchbank: P("Linnea", "Marchbank", "female", "A1", 2.1, 2),
  venterra: P("Marisol", "Venterra", "female", "A2", 3.4, 3),
  brennagh: P("Ottilie", "Brennagh", "female", "A3", 1.6, 4),
  quillfeather: P("Ansel", "Quillfeather", "male", "B1", 2.6, 5),
  pellworth: P("Imogen", "Pellworth", "female", "C1", 2.8, 6),
  pembrook: P("Corwin", "Pembrook", "male", "C2", 3.9, 7),
  wrenfield: P("Tobias", "Wrenfield", "male", "C3", 1.9, 8),
  ashgrove: P("Percival", "Ashgrove", "male", "C4", 2.4, 9),
  ardley: P("Caspian", "Ardley", "male", "C5", 1.2, 10),
  hartsworth: P("Wendeline", "Hartsworth", "female", "C6", 4.6, 11),
};

/** Raw identifying strings collected while anonymizing; the self-check greps fixtures for them. */
const secrets = new Set<string>();
const remember = (...v: (string | null | undefined)[]) => { for (const s of v) if (s && s.trim().length >= 4) secrets.add(s.trim()); };

const nppesCheckDigitOk = (npi: string): boolean => {
  // Luhn over "80840" + first 9 digits (CMS NPI check digit). Our fake NPIs start with 0 and are never valid NPIs anyway.
  const s = `80840${npi.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    let d = Number(s[s.length - 1 - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(npi[9]);
};
for (const p of Object.values(PEOPLE)) if (nppesCheckDigitOk(p.npi)) p.npi = p.npi.slice(0, 9) + String((Number(p.npi[9]) + 1) % 10);

// ---- Florida Blue (Plan A) ------------------------------------------------------------------------------------------
const fb = new FhirClient(FB.base, { timeoutMs: 30_000, counters, maxPages: 15 });

function anonymizeFbRole(role: FhirResource, person: Person, newIds: { role: string; loc: string; prac: string; hs: string }): FhirResource {
  const r = structuredClone(role) as Record<string, any>;
  r.id = newIds.role;
  for (const id of r.identifier ?? []) {
    if (!String(id.system).endsWith("/plan_id")) remember(id.value); // the plan code is kept on purpose (not identifying)
    if (id.system === "http://hl7.org/fhir/sid/us-npi") id.value = person.npi;
    else if (String(id.system).endsWith("/practitioner/identifier")) id.value = "0".repeat(64);
    else if (String(id.system).endsWith("/practitionerrole/identifier")) id.value = String(id.value).replace(/^\d{10}/, person.npi);
  }
  r.practitioner = { reference: `Practitioner/${newIds.prac}` };
  r.location = [{ reference: `Location/${newIds.loc}` }];
  r.healthcareService = (r.healthcareService ?? []).map(() => ({ reference: `HealthcareService/${newIds.hs}` }));
  for (const t of r.telecom ?? []) remember(t.value);
  r.telecom = [{ system: "phone", value: OFFICES[person.office].phone, use: "work" }];
  return r;
}
function anonymizeFbLocation(loc: FhirResource, office: Office, id: string): FhirResource {
  const l = structuredClone(loc) as Record<string, any>;
  remember(l.name, ...(l.address?.line ?? []), ...(l.telecom ?? []).map((t: any) => t.value));
  for (const i of l.identifier ?? []) { remember(i.value); i.value = "0".repeat(64); }
  l.id = id;
  l.name = office.line.toUpperCase(); // Florida Blue names a Location by its street line; the fixture keeps that habit
  l.address = { ...l.address, line: [office.line.toUpperCase()], city: office.city, state: "FL", postalCode: office.zip };
  l.telecom = [{ system: "phone", value: office.phone, use: "work" }];
  return l;
}
function anonymizeFbPractitioner(prac: FhirResource, person: Person, id: string): FhirResource {
  const p = structuredClone(prac) as Record<string, any>;
  for (const n of p.name ?? []) remember(n.text, n.family, ...(n.given ?? []));
  for (const i of p.identifier ?? []) {
    remember(i.value);
    i.value = i.system === "http://hl7.org/fhir/sid/us-npi" || String(i.system).endsWith("unique-provider-id") ? person.npi : "0".repeat(64);
  }
  p.id = id;
  p.name = [{ text: `${person.given} ${person.family}`.toUpperCase(), family: person.family.toUpperCase(), given: [person.given.toUpperCase()], suffix: ["MD"] }];
  p.gender = person.gender;
  return p;
}

type FbPick = { role: FhirResource; location: FhirResource; practitioner: FhirResource; norm: NormalizedRole; zip: string; url: string };

async function fbRolesRaw(zip: string, text: string): Promise<{ roles: NormalizedRole[]; url: string }> {
  const res = await rolesInZip(FB, fb, { zip, identifier: `${FLORIDA_BLUE_PLAN_ID_SYSTEM}|BCHPPO`, specialtyText: text, maxPages: 15, keepRaw: true });
  return { roles: res.roles.filter((r) => r.raw?.location && r.raw?.practitioner), url: res.ref };
}
const byId = (a: NormalizedRole, b: NormalizedRole) => a.roleId.localeCompare(b.roleId, "en", { numeric: true });
const pick = (r: NormalizedRole, url: string): FbPick => ({ role: r.raw!.role, location: r.raw!.location!, practitioner: r.raw!.practitioner!, norm: r, zip: r.location!.zip, url });

async function capturePlanA() {
  const netIndex = await networkIndex(fb);
  // Primary care + OB-GYN at ONE location ("same clinic"): first shared location (by id) in 32803.
  const fm = await fbRolesRaw("32803", "FAMILY");
  const ob = await fbRolesRaw("32803", "OBSTETRICS");
  const fmOnly = fm.roles.filter((r) => isSpecialty("primary_care", r.specialtyCodes, r.specialtyTexts)).sort(byId);
  const obOnly = ob.roles.filter((r) => isSpecialty("ob_gyn", r.specialtyCodes, r.specialtyTexts)).sort(byId);
  const obByLoc = new Map<string, NormalizedRole>();
  for (const r of obOnly) if (!obByLoc.has(r.location!.ref)) obByLoc.set(r.location!.ref, r);
  const pcp = fmOnly.find((r) => obByLoc.has(r.location!.ref));
  if (!pcp) throw new Error("no shared family-medicine + OB-GYN location found");
  const obgyn = obByLoc.get(pcp.location!.ref)!;
  // Gastroenterology: INTERNAL MEDICINE roles in 32803 whose NPI has NPPES taxonomy 207RG0100X.
  const im = await fbRolesRaw("32803", "INTERNAL MEDICINE");
  const giNpis = new Set((await nppesSearch({ taxonomy_description: "Gastroenterology", postal_code: "32803", address_purpose: "LOCATION", enumeration_type: "NPI-1" }, { counters, timeoutMs: 30_000 })).results.filter((x) => x.taxonomies.some((t) => t.code === "207RG0100X")).map((x) => x.number));
  const gi = im.roles.filter((r) => r.specialtyTexts.some((t) => t.toUpperCase() === "INTERNAL MEDICINE") && r.npi && giNpis.has(r.npi)).sort(byId)[0];
  if (!gi) throw new Error("no NPPES-confirmed gastroenterologist among INTERNAL MEDICINE roles in 32803");
  // Dermatology: first in the demo ZIP.
  const de = await fbRolesRaw(DEMO_ZIP, "DERMATOLOGY");
  const derm = de.roles.filter((r) => isSpecialty("dermatology", r.specialtyCodes, r.specialtyTexts)).sort(byId)[0];
  if (!derm) throw new Error("no dermatologist in demo ZIP");

  const picks: { specialty: Specialty; who: Person; p: FbPick; nppes?: string[] }[] = [
    { specialty: "primary_care", who: PEOPLE.thistlewood, p: pick(pcp, fm.url) },
    { specialty: "ob_gyn", who: PEOPLE.marchbank, p: pick(obgyn, ob.url) },
    { specialty: "gastroenterology", who: PEOPLE.venterra, p: pick(gi, im.url), nppes: ["207RG0100X"] },
    { specialty: "dermatology", who: PEOPLE.brennagh, p: pick(derm, de.url) },
  ];
  writeFileSync(join(PRIVATE, "plan-a.raw.json"), JSON.stringify({ capturedAt, picks: picks.map((x) => ({ specialty: x.specialty, url: x.p.url, role: x.p.role, location: x.p.location, practitioner: x.p.practitioner })) }, null, 1));

  for (const x of picks) {
    const office = OFFICES[x.who.office];
    const ids = { role: `fx-a-${x.specialty}`, loc: `fx-a-office-${office.key.toLowerCase()}`, prac: `fx-a-prac-${x.who.family.toLowerCase()}`, hs: `fx-a-hs-${x.specialty}` };
    remember(x.p.norm.name);
    const bundle = {
      resourceType: "Bundle",
      type: "searchset",
      link: [{ relation: "self", url: x.p.url }],
      entry: [
        { search: { mode: "match" }, resource: anonymizeFbRole(x.p.role, x.who, ids) },
        { search: { mode: "include" }, resource: anonymizeFbLocation(x.p.location, office, ids.loc) },
        { search: { mode: "include" }, resource: anonymizeFbPractitioner(x.p.practitioner, x.who, ids.prac) },
      ],
    };
    const realNet = x.p.norm.networks.map((n) => netIndex.get(n) ?? n);
    writeFixture("plan-a", x.specialty, { format: "fhir-bundle", directory: "florida-blue", networkIndex: Object.fromEntries([...netIndex].filter(([k]) => x.p.norm.networks.includes(k))), data: bundle }, {
      capturedAt,
      zip: DEMO_ZIP,
      source: { directory: FB.label, request: x.p.url, capturedFromZip: x.p.zip },
      realFieldsKept: ["PractitionerRole structure and profile", `network-reference (${x.p.norm.networks.join(", ")} = ${realNet.join(", ")})`, `plan_id identifier (BCHPPO)`, "newpatients extension", `specialty as the directory states it (${x.p.norm.specialtyTexts.join(", ")})`, "Location and Practitioner structure"],
      changed: ["practitioner name (fictional, passed guard:names)", "gender (to match the fictional name)", "NPI (replaced by an impossible number starting with 0)", "office: name, street address, ZIP, phone and resource ids (fictional office)", "the role's other locations removed", "vendor hash identifiers zeroed"],
      ...(x.nppes ? { nppesTaxonomy: { [`PractitionerRole/${ids.role}`]: x.nppes }, nppesNote: "The directory files gastroenterologists under INTERNAL MEDICINE; the captured practitioner's NPPES taxonomy was 207RG0100X (Gastroenterology) at capture time." } : {}),
      distances: { [`PractitionerRole/${ids.role}`]: x.who.distanceMi },
      distanceNote: "Fictional office: the distance is fictional too (the directory's Location has no position).",
      provenance: "directory record captured Oct 11, names and offices changed",
    });
  }
}

// ---- Oscar QHP file (Plan B) ----------------------------------------------------------------------------------------
async function capturePlanB() {
  const src = PLAN_SOURCES["plan-b"];
  if (src.kind !== "qhp-file") throw new Error("plan-b source");
  const near = ["32801", "32803", "32804", "32806"];
  const found: QhpProvider[] = [];
  let usedUrl = "";
  for (const url of src.providerFiles) {
    await streamProviders(url, (p) => {
      if (p.type !== "INDIVIDUAL" || !planIdsOf(p).includes(src.hiosPlanId)) return;
      if (!isSpecialty("allergy", [], p.specialty ?? [])) return;
      if (!(p.addresses ?? []).some((a) => near.includes(zipOf(a)))) return;
      found.push(p);
      usedUrl = url;
      return found.length >= 3;
    }, { counters, maxBytes: 2_000_000_000, timeoutMs: 900_000 });
    if (found.length) break;
  }
  if (!found.length) throw new Error("no Oscar FL allergist with the plan near the demo ZIP");
  const raw = found.sort((a, b) => String(a.npi).localeCompare(String(b.npi)))[0];
  writeFileSync(join(PRIVATE, "plan-b.raw.json"), JSON.stringify({ capturedAt, url: usedUrl, provider: raw }, null, 1));
  const who = PEOPLE.quillfeather;
  const office = OFFICES[who.office];
  const nm = raw.name as Record<string, string> | undefined;
  remember(String(raw.npi), nm?.first, nm?.last, nm?.middle, ...(raw.addresses ?? []).flatMap((a) => [a.address, a.address_2, a.phone]));
  const anon: QhpProvider = {
    ...structuredClone(raw),
    npi: who.npi,
    name: { first: who.given, last: who.family },
    gender: who.gender === "female" ? "Female" : "Male",
    languages: ["English"],
    addresses: [{ address: office.line, city: office.city, state: "FL", zip: office.zip, phone: office.phone }],
  };
  writeFixture("plan-b", "allergy", { format: "qhp-providers", directory: "oscar-qhp", data: [anon] }, {
    capturedAt,
    zip: DEMO_ZIP,
    source: { directory: "Oscar Health machine-readable provider file (CMS QHP JSON)", request: usedUrl, index: src.indexUrl, hiosPlanId: src.hiosPlanId },
    realFieldsKept: ["provider object structure", `plans[] (the provider's full list of HIOS plan ids, including ${src.hiosPlanId})`, "accepting", "specialty", "last_updated_on"],
    changed: ["name (fictional, passed guard:names)", "gender (to match the fictional name)", "languages (set to English only)", "NPI (impossible number starting with 0)", "addresses: replaced by one fictional office (street, ZIP, phone)"],
    distances: { "*": who.distanceMi },
    distanceNote: "Fictional office: the distance is fictional too (the file has no geo).",
    provenance: "plan file captured Oct 11, names and offices changed",
  });
}

// ---- Molina Florida MMA (Plan C) -----------------------------------------------------------------------------------
async function capturePlanC() {
  const mol = new FhirClient(MOLINA.base, { timeoutMs: 60_000, counters, maxPages: 5 });
  const zips = ["32806", "32803", "32804", "32801"];
  const ortho: NormalizedRole[] = [];
  for (const zip of zips) {
    const res = await rolesInZip({ ...MOLINA, pauseMs: 350 }, mol, { zip, network: "15", keepRaw: true, maxLocations: 400 });
    ortho.push(...res.roles.filter((r) => isSpecialty("orthopedics", r.specialtyCodes, r.specialtyTexts)));
    if (ortho.length >= 8) break;
  }
  if (ortho.length < 5) throw new Error(`only ${ortho.length} MMA orthopedic roles found`);
  // One role at an orthopedic location that is NOT in the MMA network (for "Not in his plan's network").
  let other: NormalizedRole | null = null;
  for (const r of ortho) {
    const res = await rolesInZip({ ...MOLINA, pauseMs: 350, maxLocationPages: 1 }, mol, { zip: r.location!.zip, keepRaw: true, maxLocations: 60 });
    other = res.roles.filter((x) => isSpecialty("orthopedics", x.specialtyCodes, x.specialtyTexts) && !x.networks.includes("15")).sort(byId)[0] ?? null;
    if (other) break;
  }
  if (!other) throw new Error("no orthopedic role outside the MMA network found");
  const ped = ortho.filter((r) => r.specialtyCodes.includes("207XP3100X") || r.specialtyTexts.some((t) => /pediatric/i.test(t))).sort(byId);
  const gen = ortho.filter((r) => !ped.includes(r)).sort(byId);
  const order = [...ped, ...gen];
  const take = (i: number) => order[i % order.length];
  const assign: { who: Person; r: NormalizedRole }[] = [
    { who: PEOPLE.pellworth, r: ped[0] ?? take(0) },
    { who: PEOPLE.pembrook, r: gen[0] ?? take(1) },
    { who: PEOPLE.wrenfield, r: gen[1] ?? take(2) },
    { who: PEOPLE.ashgrove, r: gen[2] ?? take(3) },
    { who: PEOPLE.ardley, r: other },
    { who: PEOPLE.hartsworth, r: gen[3] ?? take(4) },
  ];
  writeFileSync(join(PRIVATE, "plan-c.raw.json"), JSON.stringify({ capturedAt, assign: assign.map((a) => ({ fictional: a.who.family, raw: a.r.raw })) }, null, 1));
  const roles: FhirResource[] = [];
  const locations: FhirResource[] = [];
  const distances: Record<string, number> = {};
  for (const { who, r } of assign) {
    const office = OFFICES[who.office];
    const role = structuredClone(r.raw!.role) as Record<string, any>;
    const loc = structuredClone(r.raw!.location!) as Record<string, any>;
    const roleId = `fx-c-${who.family.toLowerCase()}`;
    const locId = `fx-c-office-${office.key.toLowerCase()}`;
    remember(r.name, role.practitioner?.display, role.organization?.display, ...(role.location ?? []).map((l: any) => l.display));
    for (const i of role.identifier ?? []) { remember(i.value); i.value = who.npi; }
    for (const t of role.telecom ?? []) { remember(t.value); t.value = office.phone; }
    role.id = roleId;
    delete role.text; // generated narrative repeats the real names
    role.practitioner = { reference: `Practitioner/fx-c-prac-${who.family.toLowerCase()}`, identifier: { value: `fx-c-prac-${who.family.toLowerCase()}` }, display: `${who.given} ${who.family}` };
    if (role.organization) role.organization = { reference: `Organization/fx-c-org-${office.key.toLowerCase()}`, identifier: { value: `fx-c-org-${office.key.toLowerCase()}` }, display: office.name };
    role.location = [{ reference: `Location/${locId}`, identifier: { value: locId }, display: office.name }];
    remember(loc.name, loc.address?.line?.join(", "), ...(loc.address?.line ?? []), ...(loc.telecom ?? []).map((t: any) => t.value), loc.managingOrganization?.display);
    delete loc.text;
    loc.id = locId;
    loc.name = office.name;
    loc.address = { ...loc.address, line: [office.line], city: office.city, state: "FL", postalCode: office.zip };
    for (const t of loc.telecom ?? []) t.value = office.phone;
    if (loc.managingOrganization) loc.managingOrganization = { reference: `Organization/fx-c-org-${office.key.toLowerCase()}`, identifier: { value: `fx-c-org-${office.key.toLowerCase()}` }, display: office.name };
    for (const i of loc.identifier ?? []) { remember(i.value); i.value = locId; }
    roles.push(role);
    if (!locations.some((l) => l.id === locId)) locations.push(loc);
    distances[`PractitionerRole/${roleId}`] = who.distanceMi;
  }
  writeFixture("plan-c", "orthopedics", { format: "fhir-roles-per-location", directory: "molina", data: { locations, roles } }, {
    capturedAt,
    zip: DEMO_ZIP,
    source: { directory: MOLINA.label, request: `${MOLINA.base}/Location?address-postalcode=<zip> -> PractitionerRole?location=<id>&network=15`, network: "15 = Medicaid-Managed Medical Assistance (MMA), Molina Healthcare of Florida" },
    realFieldsKept: ["PractitionerRole and Location structure", "network-reference (5 roles: 15 = Medicaid-Managed Medical Assistance (MMA); 1 role outside it, as captured)", "newpatients", "specialty and qualification (NUCC code) as captured", "hours (availableTime / telecom available-time) as captured"],
    changed: ["practitioner names (fictional, passed guard:names)", "NPI (impossible number starting with 0)", "offices: name, street, ZIP, phone, organization, resource ids (fictional offices)", "generated narrative (text.div) removed: it repeated the real names"],
    distances,
    distanceNote: "Fictional offices: distances are fictional too.",
    provenance: "directory record captured Oct 11, names and offices changed",
  });
}

function writeFixture(planId: string, specialty: Specialty, body: Record<string, unknown>, meta: Record<string, unknown>) {
  const base = `${planId}.${specialty}`;
  writeFileSync(join(OUT, `${base}.json`), `${JSON.stringify({ planId, specialty, zip: DEMO_ZIP, ...body }, null, 1)}\n`);
  writeFileSync(join(OUT, `${base}.meta.json`), `${JSON.stringify({ planId, specialty, ...meta }, null, 1)}\n`);
  console.log(`wrote fixtures/directory/${base}.json (+ .meta.json)`);
}

/** No raw identifying string may appear in any fixture; the same scan over the raw captures must light up. */
function selfCheck() {
  const fixtures = ["plan-a", "plan-b", "plan-c"].flatMap((p) => {
    const dir = OUT;
    return (["primary_care", "ob_gyn", "gastroenterology", "dermatology", "allergy", "orthopedics"] as Specialty[]).map((s) => join(dir, `${p}.${s}.json`)).filter(existsSync);
  });
  const text = fixtures.map((f) => readFileSync(f, "utf8").toUpperCase()).join("\n");
  const raw = ["plan-a", "plan-b", "plan-c"].map((p) => join(PRIVATE, `${p}.raw.json`)).filter(existsSync).map((f) => readFileSync(f, "utf8").toUpperCase()).join("\n");
  const list = [...secrets].filter((s) => !/^(MD|DO|FL|ORLANDO|THERE IS NO DATA.*)$/i.test(s) && !/^0+$/.test(s));
  const esc = (x: string) => x.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hit = (hay: string, s: string) => new RegExp(`(^|[^A-Z0-9])${esc(s)}($|[^A-Z0-9])`).test(hay);
  const leaks = list.filter((s) => hit(text, s));
  const control = list.filter((s) => hit(raw, s));
  console.log(`self-check: ${list.length} raw identifying strings · leaks into fixtures: ${leaks.length} · must-light control (found in raw captures): ${control.length}`);
  if (leaks.length) { console.error("LEAKS:", leaks.slice(0, 20)); process.exitCode = 1; }
  if (control.length === 0) { console.error("control did not light: the check cannot see"); process.exitCode = 1; }
}

const which = process.argv.slice(2);
const want = (k: string) => which.length === 0 || which.includes(k);
if (want("a")) await capturePlanA();
if (want("b")) await capturePlanB();
if (want("c")) await capturePlanC();
selfCheck();
console.log(counters.summary());

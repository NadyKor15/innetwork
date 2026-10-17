// Core unit tests: every refusal of SPEC §3 that lives in the core has a test named after it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgeBand } from "./age.ts";
import { checkDoctor, rankDecisions } from "./network-gate.ts";
import { gapsForWeekday, placeVisit, routineConflict, slotAt } from "./schedule.ts";
import { lintSpeech, refusalFor, LINE_N1, LINE_N7, seconds } from "./lint.ts";
import { specialtiesIn } from "./specialty.ts";
import type { DirectoryRecord, OfficePolicy, Plan, RoutineBlock } from "./types.ts";

const TZ = "America/New_York";
const planC: Plan = { planId: "plan-c", label: "Plan C", networkIds: ["NET-C"], dev: { insurer: "x", product: "y", kind: "fixture", programType: "state program", sourceMode: "fixture" } };
const rec = (id: string, over: Partial<DirectoryRecord> = {}): DirectoryRecord => ({
  recordId: id, npi: null, name: `Dr. ${id}`, specialty: "orthopedics", specialtyLabel: "Orthopedics", officeId: `office-${id}`, officeName: "Office",
  address: { line: "1 Main St", city: "Orlando", state: "FL", zip: "32801" }, distanceMi: 2, networks: ["NET-C"], newPatients: "accepting",
  source: { directory: "test directory", mode: "fixture", asOf: "2026-10-11T00:00:00Z", ref: "test" }, ...over,
});
const under2 = parseAgeBand("under two")!;
const minAge3: OfficePolicy = { officeId: "o", minAgeMonths: 36, maxAgeMonths: null, source: "office_confirmed_at_booking", learnedAt: "2026-09-01", demo: true };
const allAges: OfficePolicy = { ...minAge3, minAgeMonths: 0 };

test("age bands parse the way a parent says them", () => {
  assert.deepEqual(parseAgeBand("under two"), { label: "under 2", minMonths: 0, maxMonths: 23 });
  assert.deepEqual(parseAgeBand("He's under 2".replace(/^He's /, "")), { label: "under 2", minMonths: 0, maxMonths: 23 });
  assert.deepEqual(parseAgeBand("five-year-old"), { label: "5", minMonths: 60, maxMonths: 71 });
  assert.deepEqual(parseAgeBand("18 months"), { label: "18 months", minMonths: 18, maxMonths: 18 });
  assert.equal(parseAgeBand("a toddler"), null);
});

test("N2: in network only with the plan's network id; out of network is set aside with the reason", () => {
  const ok = checkDoctor({ record: rec("a"), plan: planC, ageBand: null, policy: null, directoryAnswered: true, pronoun: "he" });
  assert.equal(ok.network.status, "in_network");
  assert.equal(ok.network.reason, "in Plan C's network");
  const out = checkDoctor({ record: rec("b", { networks: ["NET-A"] }), plan: planC, ageBand: null, policy: null, directoryAnswered: true, pronoun: "he" });
  assert.equal(out.verdict, "set_aside");
  assert.equal(out.customerReason, "Not in his plan's network");
});

test("N3: three age outcomes, each with a source; no age data never fits a child's search", () => {
  const no = checkDoctor({ record: rec("w"), plan: planC, ageBand: under2, policy: minAge3, directoryAnswered: true, pronoun: "he" });
  assert.equal(no.age.status, "does_not_see_this_age");
  assert.equal(no.customerReason, "Doesn't see children under 3");
  assert.match(no.age.source, /office policy · learned from a past booking · demo data/);
  assert.match(no.fullReason!, /confirmed by the office at a past booking · demo data/);
  const yes = checkDoctor({ record: rec("p"), plan: planC, ageBand: under2, policy: allAges, directoryAnswered: true });
  assert.equal(yes.verdict, "fits");
  assert.equal(yes.age.status, "sees_this_age");
  const unknown = checkDoctor({ record: rec("h"), plan: planC, ageBand: under2, policy: null, directoryAnswered: true });
  assert.equal(unknown.verdict, "ask_office");
  assert.equal(unknown.customerReason, "Age not listed · we'll ask the office when booking");
});

test("N3: the taxonomy alone never sets a doctor aside (a general orthopedist who sees toddlers stays)", () => {
  const general = checkDoctor({ record: rec("g", { specialtyLabel: "Orthopedics" }), plan: planC, ageBand: under2, policy: allAges, directoryAnswered: true });
  const pediatric = checkDoctor({ record: rec("q", { specialtyLabel: "Pediatric orthopedics" }), plan: planC, ageBand: parseAgeBand("17")!, policy: { ...allAges, maxAgeMonths: 215 }, directoryAnswered: true });
  assert.equal(general.verdict, "fits");
  assert.equal(pediatric.verdict, "fits");
});

test("N8: directory did not answer -> not confirmed, never fits", () => {
  const d = checkDoctor({ record: rec("x"), plan: planC, ageBand: null, policy: null, directoryAnswered: false });
  assert.equal(d.verdict, "not_confirmed");
  assert.equal(d.network.status, "unknown");
  assert.equal(d.customerReason, "Not confirmed — directory didn't answer");
});

test("gate is deterministic: byte-identical decisions for identical inputs", () => {
  const a = JSON.stringify(checkDoctor({ record: rec("w"), plan: planC, ageBand: under2, policy: minAge3, directoryAnswered: true, pronoun: "he" }));
  const b = JSON.stringify(checkDoctor({ record: rec("w"), plan: planC, ageBand: under2, policy: minAge3, directoryAnswered: true, pronoun: "he" }));
  assert.equal(a, b);
});

test("N13: ranking is by distance, slot and name only (no notes input exists)", () => {
  const records = new Map([rec("near", { distanceMi: 1 }), rec("far", { distanceMi: 5 }), rec("mid", { distanceMi: 3, networks: ["NET-A"] })].map((r) => [r.recordId, r]));
  const ds = [...records.values()].map((r) => checkDoctor({ record: r, plan: planC, ageBand: null, policy: null, directoryAnswered: true }));
  const ranked = rankDecisions(ds, records);
  assert.deepEqual(ranked.fits.map((d) => d.recordId), ["near", "far"]);
  assert.deepEqual(ranked.setAside.map((d) => d.recordId), ["mid"]);
});

const routine: RoutineBlock[] = [
  { label: "Daycare drop-off", days: [1, 2, 3, 4, 5], start: "07:50", end: "08:15" },
  { label: "Daycare pick-up", days: [1, 2, 3, 4, 5], start: "11:45", end: "12:10" },
];
const now = slotAt("2026-10-16", "19:45", 1, TZ).start;
const yearEnd = slotAt("2026-12-31", "23:59", 1, TZ).start;

test("N12: weekday gaps around the routine: 8:30-11:15 child away, 12:25-17:00 with kids", () => {
  assert.deepEqual(gapsForWeekday(1, routine), [
    { start: 8 * 60 + 30, end: 11 * 60 + 15, kind: "child_away" },
    { start: 12 * 60 + 25, end: 17 * 60, kind: "with_kids" },
  ]);
});

test("N12-routine-overlap: a slot inside drop-off or pick-up is skipped; adult goes while the child is away", () => {
  const slots = [slotAt("2026-10-19", "08:00", 45, TZ), slotAt("2026-10-20", "12:00", 45, TZ), slotAt("2026-10-22", "09:15", 45, TZ)];
  const p = placeVisit({ slots, role: "adult", routine, tz: TZ, now, planYearEnd: yearEnd, calendar: [], officeId: "o" });
  assert.equal(p.ok && p.tier, "preferred");
  assert.equal(p.ok && p.slot.start, slots[2].start);
  assert.equal(routineConflict(slots[0], routine, TZ)?.label, "Daycare drop-off");
});

test("N12: a child's visit goes after pick-up first", () => {
  const slots = [slotAt("2026-10-19", "09:00", 45, TZ), slotAt("2026-10-19", "13:30", 45, TZ)];
  const p = placeVisit({ slots, role: "child", routine, tz: TZ, now, planYearEnd: yearEnd, calendar: [], officeId: "o" });
  assert.equal(p.ok && p.slot.start, slots[1].start);
});

test("N12: with no free slot before the reset, the only offer is over the routine and is marked as such", () => {
  const slots = [slotAt("2026-10-19", "11:30", 45, TZ)];
  const p = placeVisit({ slots, role: "adult", routine, tz: TZ, now, planYearEnd: yearEnd, calendar: [], officeId: "o" });
  assert.equal(p.ok && p.tier, "over_routine");
  assert.equal(p.ok && p.tier === "over_routine" && p.conflict, "Daycare pick-up");
});

test("N12 mutation: with the routine filter off, the drop-off slot wins (proves the filter is what skips it)", () => {
  const slots = [slotAt("2026-10-19", "08:00", 45, TZ), slotAt("2026-10-22", "09:15", 45, TZ)];
  const p = placeVisit({ slots, role: "adult", routine, tz: TZ, now, planYearEnd: yearEnd, calendar: [], officeId: "o", routineFilter: false });
  assert.equal(p.ok && p.slot.start, slots[0].start);
});

test("calendar: a slot that clashes with a booked visit (plus the drive) is skipped; same office back-to-back is fine", () => {
  const booked = slotAt("2026-10-22", "09:15", 45, TZ);
  const slots = [slotAt("2026-10-22", "09:15", 45, TZ), slotAt("2026-10-23", "09:30", 45, TZ)];
  const p = placeVisit({ slots, role: "adult", routine, tz: TZ, now, planYearEnd: yearEnd, calendar: [{ ...booked, officeId: "gi" }], officeId: "derm" });
  assert.equal(p.ok && p.slot.start, slots[1].start);
  const pcp = slotAt("2026-10-20", "09:00", 45, TZ);
  const ob = [slotAt("2026-10-20", "09:45", 30, TZ)];
  const q = placeVisit({ slots: ob, role: "adult", routine, tz: TZ, now, planYearEnd: yearEnd, calendar: [{ ...pcp, officeId: "clinic" }], officeId: "clinic" });
  assert.equal(q.ok && q.slot.start, ob[0].start);
});

test("N9: no 'free', and a coverage line needs 'usually' and a named source", () => {
  assert.deepEqual(lintSpeech("After the out-of-pocket max, plans usually pay 100% of covered in-network care until the plan year ends — per HealthCare.gov."), []);
  assert.equal(lintSpeech("Your visits are free after the max.")[0].rule, "N9");
  assert.equal(lintSpeech("After the out-of-pocket max your plan pays 100%.")[0].rule, "N9");
  assert.equal(lintSpeech("There is no cost for these.")[0].rule, "N9");
});

test("N5: no member ID read aloud", () => {
  assert.equal(lintSpeech("Your member ID is XJH4821937.")[0].rule, "N5");
  assert.deepEqual(lintSpeech("All between 8:30 and 11, while he's at daycare."), []);
});

test("N7: emergencies get the fixed line; no promises of help", () => {
  assert.deepEqual(refusalFor("Alexa, my son has chest pain, it's an emergency", false), { rule: "N7", line: LINE_N7 });
  assert.equal(lintSpeech("I'll get you help right away.")[0].rule, "N7");
});

test("N1-symptom-refusal: a symptom without a specialty gets the fixed answer; a named specialty does not", () => {
  assert.deepEqual(refusalFor("Alexa, my son has a rash, who should we see?", specialtiesIn("my son has a rash").length > 0), { rule: "N1", line: LINE_N1 });
  assert.equal(refusalFor("find a dermatologist for my rash", specialtiesIn("find a dermatologist for my rash").length > 0), null);
});

test("voice budget: one reply at most 20 seconds", () => {
  assert.ok(seconds("Your gastroenterologist is already booked for Thursday. Tuesday, same clinic: primary care, then OB-GYN. Friday: dermatology. All while he's at daycare. Book these three?") <= 12);
  assert.equal(lintSpeech("word ".repeat(51))[0].rule, "budget");
});

test("specialties are found in the order the parent says them", () => {
  const s = specialtiesIn("I need a gastroenterologist, an allergist for my five-year-old, and an orthopedist for my little one");
  assert.deepEqual(s.map((x) => x.specialty), ["gastroenterology", "allergy", "orthopedics"]);
});

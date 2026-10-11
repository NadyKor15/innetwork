// InNetwork MCP server: tools + MCP Apps views. One factory for both protocol eras (2025-11-25 sessions,
// 2026-07-28 per-request), so they cannot drift apart.
//
// Every tool result carries:
//   content[0].text      Alexa's line(s), voice-first: the answer makes sense without the screen
//   structuredContent    { speech, speechParts, seconds, view, card, data }
//   _meta.steps          [{ service, op, mode, ms, summary }] for the developer view only (never spoken, never on cards)
//
// Refusals enforced here (SPEC §3): N2 out-of-network needs a second yes · N4 ages are a request parameter, never
// stored · N6 nothing is looked up before consent · N10 lab work is not booked before the primary care visit ·
// N11 real directory records never get slots, age policies or a booking · N12 no visit over the routine without a
// yes · N13 notes stay in the household and never reorder results. N1/N5/N7/N9 live in src/core/lint.ts and every
// line goes through assertSpeech.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer, LATEST_PROTOCOL_VERSION, type ServerContext } from "@modelcontextprotocol/server";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { parseAgeBand } from "../src/core/age.ts";
import { labWorkStatus, planCheckup, type BookedVisit, type Candidate, type CheckupLine } from "../src/core/checkup.ts";
import { seconds } from "../src/core/lint.ts";
import { checkDoctor, rankDecisions, type Pronoun } from "../src/core/network-gate.ts";
import { gapsForWeekday, placeVisit, type BusyVisit } from "../src/core/schedule.ts";
import { CHECKUP_ORDER, SPECIALTY_WORDS, itemField } from "../src/core/specialty.ts";
import { minutesOfDay, toZoned, weekdayLong } from "../src/core/time.ts";
import { SPECIALTIES, type AgeBand, type CheckupItem, type Decision, type DirectoryAnswer, type DirectoryRecord, type DirectoryService, type NetworkProbe, type OfficePolicy, type Plan, type SourceMode, type Specialty } from "../src/core/types.ts";
import * as C from "./cards.ts";
import * as S from "./speech.ts";
import { loadPolicies, loadUser, savePolicy, updateUser, type Member, type Proposal, type UserState, type Visit } from "./store.ts";
import { seedHousehold, type Scenario } from "./scenario.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const VIEWS: C.ViewName[] = ["family-match", "set-aside", "visit-plan", "booked", "checkup-year", "consent"];
export const viewUri = (v: C.ViewName) => `ui://innetwork/${v}.html`;

export type Step = { service: string; op: string; mode: SourceMode; ms: number; summary: string };
export type Services = {
  directory: DirectoryService;
  scenario: Scenario;
  policiesSeed: string | null;
  /** Sandbox clock: the demo's "now" (fixed, from the scenario) unless a test moves it. */
  now(): number;
  /** Latest live probe per plan, for /devinfo. */
  probes: Map<string, NetworkProbe>;
};

export function userIdOf(ctx: ServerContext): string {
  const id = ctx.http?.authInfo?.extra?.userId;
  if (typeof id !== "string" || !id) throw new Error("account not linked");
  return id;
}

class Steps {
  readonly list: Step[] = [];
  add(s: Step) { this.list.push(s); }
  sync<T>(service: string, op: string, mode: SourceMode, fn: () => T, summary: (r: T) => string): T {
    const t0 = performance.now();
    const r = fn();
    this.list.push({ service, op, mode, ms: Math.round(performance.now() - t0), summary: summary(r) });
    return r;
  }
}

type Reply = { content: { type: "text"; text: string }[]; structuredContent: Record<string, unknown>; _meta: { steps: Step[]; gate?: string[] }; isError?: boolean };
function reply(view: C.ViewName | null, parts: string[], card: C.CardModel | null, data: Record<string, unknown>, steps: Steps, isError = false, gate?: string[]): Reply {
  if (!steps.list.length) steps.add({ service: "Household state", op: "read", mode: "sandbox", ms: 0, summary: "answered from saved state" });
  const speech = parts.join(" ");
  return {
    content: [{ type: "text", text: speech }],
    structuredContent: { speech, speechParts: parts, seconds: parts.map(seconds), view, card, data },
    _meta: { steps: steps.list, ...(gate ? { gate } : {}) },
    ...(isError ? { isError: true } : {}),
  };
}

/** Developer-view lines that show the deterministic gate at work (never on customer cards). */
function gateLines(lookups: Lookup[], u: UserState): string[] {
  const out: string[] = [];
  for (const lk of lookups) {
    const d = lk.decisions.find((x) => x.age.status === "does_not_see_this_age") ?? lk.decisions.find((x) => x.network.status === "out_of_network");
    if (!d) continue;
    out.push(d.age.status === "does_not_see_this_age" ? `check_doctor → does_not_see_this_age (${d.age.source})` : `check_doctor → out_of_network (${d.network.source})`);
    break;
  }
  out.push(`family_routine → ${u.routine.length} weekday blocks · slots inside them skipped`);
  out.push("doctor_notes → private to this family · not used for ranking");
  return out;
}

// ---------- helpers ----------
const seedFor = (sv: Services, recordIdOf: (n: string) => string | null) => (id: string) => seedHousehold(sv.scenario, id, recordIdOf);
const memberBy = (u: UserState, said: string): Member | undefined => {
  const s = said.toLowerCase().trim();
  return u.family.find((m) => m.memberId === said || m.label.toLowerCase() === s)
    ?? u.family.find((m) => (/(mom|me|myself|my own)/.test(s) && m.role === "adult") || (/(youngest|little one|baby|toddler)/.test(s) && /youngest/i.test(m.label)) || (/(older|oldest|big)/.test(s) && /older/i.test(m.label)));
};
const planOf = (sv: Services, m: Member): Plan => {
  const p = sv.directory.plans.find((x) => x.planId === m.planId);
  if (!p) throw new Error(`no plan ${m.planId}`);
  return p;
};
const isSandboxRecord = (r: DirectoryRecord) => r.source.mode === "fixture" || r.source.mode === "sandbox";
/** N11: only fictional (recorded-sample) doctors get sandbox slots; real live records never do. */
const slotsOf = (sv: Services, r: DirectoryRecord) => (isSandboxRecord(r) ? sv.scenario.slotsFor(r.name) : []);
const activeVisits = (u: UserState, now: number) => u.visits.filter((v) => v.status === "booked" && v.end > now);
const busyOf = (u: UserState, now: number): BusyVisit[] => activeVisits(u, now).map((v) => ({ start: v.start, end: v.end, officeId: v.officeId }));
const childPronounOfRoutine = (u: UserState): { pronoun: Pronoun; word: string } | null => {
  const b = u.routine.find((x) => /drop[- ]?off/i.test(x.label));
  if (!b) return null;
  const m = u.family.find((x) => x.memberId === b.memberId) ?? u.family.find((x) => x.role === "child");
  return { pronoun: m?.pronoun ?? "they", word: b.label.toLowerCase().replace(/\s*(drop[- ]?off|pick[- ]?up)\s*/i, "").trim() || "school" };
};
const contr = (p: Pronoun) => (p === "he" ? "he's" : p === "she" ? "she's" : "they're");
const childAwayWindow = (u: UserState) => {
  const g = gapsForWeekday(1, u.routine).find((x) => x.kind === "child_away");
  const who = childPronounOfRoutine(u);
  return g && who ? { startMin: g.start, endMin: g.end, whoPronoun: contr(who.pronoun), routineWord: who.word } : null;
};
const noteFor = (u: UserState, r: DirectoryRecord) => u.notes.find((n) => n.recordId === r.recordId || n.doctorName === r.name)?.text ?? null;
const toBooked = (v: Visit): BookedVisit => ({ item: v.item, start: v.start, end: v.end, officeId: v.officeId, recordId: v.recordId, memberId: v.memberId });

type Lookup = { member: Member; plan: Plan; specialty: Specialty; ageBand: AgeBand | null; answer: DirectoryAnswer; decisions: Decision[]; records: Map<string, DirectoryRecord>; probe: NetworkProbe | null };

async function lookupFor(sv: Services, steps: Steps, u: UserState, member: Member, specialty: Specialty, ageBand: AgeBand | null): Promise<Lookup> {
  const plan = planOf(sv, member);
  const answer = await sv.directory.lookup(plan, specialty, u.profile.zip);
  steps.add({
    service: answer.directory, op: `${SPECIALTY_WORDS[specialty].field} · ZIP ${u.profile.zip} · ${plan.label}`, mode: answer.mode, ms: answer.ms,
    summary: answer.ok ? `${answer.records.length} records${answer.inNetworkCount !== null ? ` · ${answer.inNetworkCount} in ${plan.label}'s network` : ""}` : `did not answer: ${answer.error} · NOT confirmed`,
  });
  let probe: NetworkProbe | null = null;
  if (sv.directory.probe) {
    probe = await sv.directory.probe(plan, specialty, u.profile.zip);
    if (probe) {
      sv.probes.set(plan.planId, probe);
      steps.add({ service: probe.directory, op: `live network check · ${probe.ref}`, mode: "live", ms: probe.ms, summary: probe.ok ? `${probe.inNetworkCount} in-network practitioners for this specialty in ZIP ${u.profile.zip}` : `did not answer: ${probe.error} · not confirmed` });
    }
  }
  const policies = loadPolicies(sv.policiesSeed);
  const records = new Map((answer.ok ? answer.records : []).map((r) => [r.recordId, r]));
  // Live records (real doctors) are never matched to the sandbox's demo age policies (N11).
  const policyOf = (r: DirectoryRecord): OfficePolicy | null => (isSandboxRecord(r) ? policies.find((p) => p.officeId === r.officeId) ?? null : null);
  const decisions = steps.sync("network gate", "deterministic rules, no model", "sandbox", () => [...records.values()].map((record) => checkDoctor({ record, plan, ageBand, policy: policyOf(record), directoryAnswered: answer.ok, pronoun: member.pronoun })),
    (ds) => `${ds.filter((d) => d.verdict === "fits").length} fit · ${ds.filter((d) => d.verdict === "set_aside").length} set aside · ${ds.filter((d) => d.verdict === "ask_office").length} ask office${ageBand ? ` · age band "${ageBand.label}" used for this search only` : ""}`);
  return { member, plan, specialty, ageBand, answer, decisions, records, probe };
}

/** Pick the proposal for one lookup: first fit with a placeable slot; or the member's existing visit with that doctor. */
function proposalFor(sv: Services, u: UserState, lk: Lookup, calendar: BusyVisit[], now: number) {
  const firstSlot = new Map([...lk.records.values()].map((r) => [r.recordId, slotsOf(sv, r).find((s) => s.start >= now)?.start ?? null]));
  const ranked = rankDecisions(lk.decisions, lk.records, firstSlot);
  const existing = activeVisits(u, now).find((v) => v.memberId === lk.member.memberId && ranked.fits.some((d) => d.recordId === v.recordId));
  if (existing) return { ranked, existing, proposal: null as Proposal | null, placementNote: null as string | null };
  for (const d of ranked.fits) {
    const r = lk.records.get(d.recordId)!;
    const slots = slotsOf(sv, r);
    if (!slots.length) continue;
    const p = placeVisit({ slots, role: lk.member.role, routine: u.routine, tz: u.profile.timeZone, now, planYearEnd: sv.scenario.planYearEndMs, calendar, officeId: r.officeId });
    if (!p.ok) continue;
    const proposal: Proposal = { memberId: lk.member.memberId, item: lk.specialty, recordId: r.recordId, doctorName: r.name, specialtyLabel: r.specialtyLabel, officeId: r.officeId, officeName: r.officeName, distanceMi: r.distanceMi, start: p.slot.start, end: p.slot.end, networkStatus: d.network.status, overRoutine: p.tier === "over_routine" ? p.conflict : null };
    return { ranked, existing: null, proposal, placementNote: p.tier === "over_routine" ? p.conflict : null };
  }
  return { ranked, existing: null, proposal: null, placementNote: null };
}

const fitDetail = (d: Decision, r: DirectoryRecord, child: boolean) =>
  [d.network.reason, child ? (d.age.status === "sees_this_age" ? "sees this age" : null) : r.newPatients === "accepting" ? "accepting new patients" : null].filter(Boolean).join(" · ");

function sourceLineOf(records: DirectoryRecord[]): string | null {
  const r = records.find((x) => x.source.provenance);
  if (!r) return null;
  return `In-network · ${r.source.provenance}`;
}

// ---------- the server ----------
export type BuildOptions = { era: "legacy" | "modern"; services: Services; assetBase?: string };

export function buildMcpServer({ era, services: sv, assetBase = "" }: BuildOptions): McpServer {
  const server = new McpServer(
    { name: "innetwork", title: "InNetwork", version: "0.1.0" },
    {
      ...(era === "legacy" ? { supportedProtocolVersions: [LATEST_PROTOCOL_VERSION] } : {}),
      instructions:
        "InNetwork finds a doctor for each person in a family inside that person's own plan's network, sets aside doctors who can't see them (with the reason and its source), and books visits around the family routine. " +
        "First run: consent(show) then consent(allow). Flow: find_in_network (one or several people) -> book_visit(confirm=false reads back, confirm=true books) · checkup_year(plan|status) · cancel_visit · family_plans · family_routine · doctor_notes · check_doctor. " +
        "The parent names the specialty; the add-on never picks one or interprets symptoms. Ages are said per search and never stored. Bookings are sandbox.",
    },
  );
  const recordIdOf = (name: string) => null as string | null; // notes are matched by name until a record id is known
  const seed = seedFor(sv, recordIdOf);
  const consentGate = (u: UserState, steps: Steps, view: C.ViewName) => (u.consent?.granted ? null : reply("consent", [S.CONSENT_REQUIRED], C.consentCard("ask"), { consentRequired: true }, steps, true));
  const memberArg = z.string().trim().min(1).max(40).describe('Who it is for, as the parent says it: "Mom", "Older child", "Youngest", "my youngest", "me"');
  const specialtyArg = z.enum(SPECIALTIES).describe("Specialty the parent named (closed list). Never infer it from symptoms.");
  const ageArg = z.string().trim().min(1).max(30).optional().describe('Age as the parent said it for THIS search only, e.g. "under 2", "5". Never stored.');

  // ---------- consent (N6) ----------
  registerAppTool(server, "consent", {
    title: "Before we start",
    description: "Show what InNetwork uses and why, and record the parent's answer. Nothing is looked up before 'allow'.",
    inputSchema: z.object({ action: z.enum(["show", "allow", "decline"]) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: viewUri("consent") } },
  }, async ({ action }, ctx) => {
    const uid = userIdOf(ctx);
    const steps = new Steps();
    const now = sv.now();
    if (action === "show") { loadUser(uid, seed); return reply("consent", [S.CONSENT_ASK], C.consentCard("ask"), { consent: "asked" }, steps); }
    const granted = action === "allow";
    updateUser(uid, seed, (s) => { s.consent = { granted, at: now, purpose: "find in-network doctors and book visits for your family" }; });
    steps.add({ service: "Household state", op: "consent", mode: "sandbox", ms: 0, summary: granted ? "allowed · purpose stated" : "declined" });
    return reply("consent", [granted ? S.CONSENT_GIVEN : S.CONSENT_DECLINED], C.consentCard(granted ? "granted" : "declined"), { consent: granted ? "granted" : "declined" }, steps);
  });

  // ---------- family_plans ----------
  server.registerTool("family_plans", {
    title: "Family and plans",
    description: "List who is in the household and which plan each person is on (labels only: Plan A/B/C), or move a person to another of the household's plans.",
    inputSchema: z.object({ action: z.enum(["list", "set"]).default("list"), member: memberArg.optional(), plan: z.string().regex(/^Plan [A-Z]$/).optional() }).strict(),
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async ({ action, member, plan }, ctx) => {
    const uid = userIdOf(ctx);
    const steps = new Steps();
    const u = loadUser(uid, seed);
    const gate = consentGate(u, steps, "consent"); if (gate) return gate;
    if (action === "set") {
      const m = member ? memberBy(u, member) : undefined;
      const p = sv.directory.plans.find((x) => x.label === plan);
      if (!m || !p) return reply(null, [`I couldn't match that. Say who it's for and which plan, like "Youngest, Plan C".`], null, {}, steps, true);
      updateUser(uid, seed, (s) => { s.family.find((x) => x.memberId === m.memberId)!.planId = p.planId; });
    }
    const fresh = loadUser(uid, seed);
    const list = fresh.family.map((m) => `${m.label}: ${planOf(sv, m).label}`);
    return reply(null, [`${list.join(". ")}.`], null, { family: fresh.family.map((m) => ({ label: m.label, plan: planOf(sv, m).label })) }, steps);
  });

  // ---------- family_routine (N12) ----------
  server.registerTool("family_routine", {
    title: "Family routine",
    description: "List or replace the household's weekday routine blocks (label and time only, e.g. 'Daycare drop-off 07:50-08:15'). Visits are never placed over these without a yes.",
    inputSchema: z.object({
      action: z.enum(["list", "set"]).default("list"),
      blocks: z.array(z.object({ label: z.string().trim().min(2).max(40), days: z.array(z.number().int().min(1).max(7)).min(1).max(7), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/), for_member: memberArg.optional() }).strict()).max(8).optional(),
    }).strict(),
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async ({ action, blocks }, ctx) => {
    const uid = userIdOf(ctx);
    const steps = new Steps();
    const u = loadUser(uid, seed);
    const gate = consentGate(u, steps, "consent"); if (gate) return gate;
    if (action === "set" && blocks) {
      updateUser(uid, seed, (s) => { s.routine = blocks.map((b) => ({ label: b.label, days: b.days, start: b.start, end: b.end, memberId: b.for_member ? memberBy(s, b.for_member)?.memberId : undefined })); });
    }
    const r = loadUser(uid, seed).routine;
    steps.add({ service: "Household state", op: "family_routine", mode: "sandbox", ms: 0, summary: `${r.length} weekday blocks · slots inside them skipped` });
    return reply(null, [r.length ? `Your routine: ${r.map((b) => `${b.label.toLowerCase()} ${b.start} to ${b.end}`).join(", ")}.` : "You haven't told me a routine yet."], null, { routine: r.map((b) => ({ label: b.label, days: b.days, start: b.start, end: b.end })) }, steps);
  });

  // ---------- doctor_notes (N13) ----------
  server.registerTool("doctor_notes", {
    title: "Your notes about doctors",
    description: "Save or list the parent's own words about a doctor. Notes stay with this household, are shown as 'Your note', and never change the order of results.",
    inputSchema: z.object({ action: z.enum(["list", "add"]).default("list"), doctor: z.string().trim().min(3).max(80).optional(), text: z.string().trim().min(2).max(140).optional() }).strict(),
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async ({ action, doctor, text }, ctx) => {
    const uid = userIdOf(ctx);
    const steps = new Steps();
    const u = loadUser(uid, seed);
    const gate = consentGate(u, steps, "consent"); if (gate) return gate;
    if (action === "add") {
      if (!doctor || !text) return reply(null, ["Tell me the doctor and what you want to remember."], null, {}, steps, true);
      updateUser(uid, seed, (s) => { s.notes = s.notes.filter((n) => n.doctorName !== doctor); s.notes.push({ recordId: `name:${doctor}`, doctorName: doctor, text, at: sv.now() }); });
    }
    const notes = loadUser(uid, seed).notes;
    steps.add({ service: "Household state", op: "doctor_notes", mode: "sandbox", ms: 0, summary: `${notes.length} note(s) · private to this family · not used for ranking` });
    return reply(null, [notes.length ? `You have ${S.numberWord(notes.length)} note${notes.length === 1 ? "" : "s"} about doctors.` : "No notes yet."], null, { notes: notes.map((n) => ({ doctor: n.doctorName, text: n.text })) }, steps);
  });

  // ---------- find_in_network ----------
  registerAppTool(server, "find_in_network", {
    title: "Find in-network doctors",
    description: "Find a doctor for one or more family members, each in their own plan's network. Doctors who aren't in network, don't see a child's age (office policy) or aren't taking new patients are set aside with the reason. Proposes visit times around the family routine; nothing is booked until book_visit(confirm=true).",
    inputSchema: z.object({
      requests: z.array(z.object({ member: memberArg, specialty: specialtyArg, age_for_this_search: ageArg }).strict()).min(1).max(4),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { ui: { resourceUri: viewUri("family-match") } },
  }, async ({ requests }, ctx) => {
    const uid = userIdOf(ctx);
    const steps = new Steps();
    const now = sv.now();
    const u = loadUser(uid, seed);
    const gate = consentGate(u, steps, "family-match"); if (gate) return gate;
    const lookups: Lookup[] = [];
    for (const rq of requests) {
      const member = memberBy(u, rq.member);
      if (!member) return reply(null, [`I don't know who "${rq.member}" is in your family. You can say Mom, Older child or Youngest.`], null, {}, steps, true);
      let band: AgeBand | null = null;
      if (member.role === "child") {
        band = rq.age_for_this_search ? parseAgeBand(rq.age_for_this_search) : null;
        if (!band) return reply(null, [`How old is ${member.pronoun === "they" ? "your child" : member.pronoun === "he" ? "he" : "she"}? I use it for this search only.`], null, { needsAge: member.label }, steps, true);
      }
      lookups.push(await lookupFor(sv, steps, u, member, rq.specialty, band));
    }
    const calendar = busyOf(u, now);
    const picks = lookups.map((lk) => {
      const p = proposalFor(sv, u, lk, calendar, now);
      if (p.proposal) calendar.push({ start: p.proposal.start, end: p.proposal.end, officeId: p.proposal.officeId });
      return { lk, ...p };
    });
    const proposals = picks.flatMap((p) => (p.proposal ? [p.proposal] : []));
    updateUser(uid, seed, (s) => { s.pending = proposals.length ? { kind: "book", from: "find_in_network", proposals, at: now } : null; });
    const tz = u.profile.timeZone;

    if (lookups.length === 1) {
      // ---- one person, one specialty: the whole picture (screen 05) ----
      const { lk, ranked, existing, proposal } = picks[0];
      const child = lk.member.role === "child";
      const fits = ranked.fits.map((d) => {
        const r = lk.records.get(d.recordId)!;
        const booked = existing?.recordId === r.recordId ? existing : null;
        // Every time shown passes the routine and the family calendar (N12), not just the proposal's.
        const placed = booked || proposal?.recordId === r.recordId ? null : placeVisit({ slots: slotsOf(sv, r), role: lk.member.role, routine: u.routine, tz, now, planYearEnd: sv.scenario.planYearEndMs, calendar: busyOf(u, now), officeId: r.officeId, bookOverRoutine: false });
        const when = booked ? booked.start : proposal?.recordId === r.recordId ? proposal.start : placed?.ok ? placed.slot.start : null;
        return { name: r.name, specialtyLabel: r.specialtyLabel, checks: [d.network.reason, ...(child && d.age.status === "sees_this_age" ? ["sees this age"] : []), ...(!child && r.newPatients === "accepting" ? ["accepting new patients"] : [])], when: when ? C.whenLabel(when, tz) : null, booked: !!booked };
      });
      const kindOf = (d: Decision): C.SetAsideCard["setAside"][number]["kind"] => (d.network.status === "out_of_network" ? "network" : d.newPatients.status === "not_accepting" ? "new_patients" : "age");
      const card: C.SetAsideCard = {
        view: "set-aside",
        heading: { member: C.colorOf(lk.member, u.family), specialty: SPECIALTY_WORDS[lk.specialty].field, forWhom: child ? `for your ${lk.member.label.toLowerCase()}${lk.ageBand ? ` (${lk.ageBand.label})` : ""}` : "for you", plan: `on ${lk.plan.label}` },
        fitsTitle: child ? "These see children this age" : "These fit",
        fits,
        setAsideTitle: "Set aside before you call",
        setAside: [
          ...ranked.setAside.map((d) => ({ name: lk.records.get(d.recordId)!.name, reason: d.customerReason!, kind: kindOf(d) })),
          ...ranked.askOffice.map((d) => ({ name: lk.records.get(d.recordId)!.name, reason: d.customerReason!, kind: "ask_office" as const })),
          ...ranked.notConfirmed.map((d) => ({ name: lk.records.get(d.recordId)!.name, reason: d.customerReason!, kind: "not_confirmed" as const })),
        ],
        footer: lk.ageBand ? "Age used for this search only · not saved" : null,
      };
      const ageAside = ranked.setAside.filter((d) => d.age.status === "does_not_see_this_age" && d.network.status === "in_network");
      const under = ageAside.length && ageAside.every((d) => /under (\d+)/.test(d.customerReason ?? "")) ? (ageAside[0].customerReason!.match(/under (\d+)/)![1]) : null;
      const speech = lk.answer.ok
        ? S.searchSummary({ checked: lk.records.size, ageSetAside: { count: ageAside.length, under: ageAside.every((d) => d.customerReason === ageAside[0]?.customerReason) ? under : null }, network: ranked.setAside.filter((d) => d.network.status === "out_of_network").length, notAccepting: ranked.setAside.filter((d) => d.network.status === "in_network" && d.newPatients.status === "not_accepting").length, fits: ranked.fits.length, askOffice: ranked.askOffice.length, pronoun: lk.member.pronoun, adult: !child })
        : `I couldn't reach ${lk.plan.label}'s directory just now, so I can't confirm who's in network. Try again in a minute.`;
      return reply("set-aside", [speech], card, { member: lk.member.label, plan: lk.plan.label, checked: lk.records.size, fits: ranked.fits.length, setAside: ranked.setAside.length, askOffice: ranked.askOffice.length, proposal: proposal ? { doctor: proposal.doctorName, start: new Date(proposal.start).toISOString() } : null, ageUsedForThisSearchOnly: !!lk.ageBand }, steps, false, gateLines(lookups, u));
    }

    // ---- several people (screen 01) ----
    const rows: C.FamilyRow[] = picks.map(({ lk, ranked, existing, proposal }) => {
      const child = lk.member.role === "child";
      const fitRec = existing ? lk.records.get(existing.recordId) : proposal ? lk.records.get(proposal.recordId) : null;
      const fitDec = fitRec ? lk.decisions.find((d) => d.recordId === fitRec.recordId)! : null;
      // compact: the first set-aside doctor of each reason kind (one age reason, one network reason), max two
      const kinds = new Set<string>();
      const compact = ranked.setAside.filter((d) => { const k = d.network.status === "out_of_network" ? "n" : d.newPatients.status === "not_accepting" ? "p" : "a"; if (kinds.has(k)) return false; kinds.add(k); return true; }).slice(0, 2);
      return {
        member: C.colorOf(lk.member, u.family), memberLabel: lk.member.label, ageLabel: child && lk.ageBand ? lk.ageBand.label : null, planLabel: lk.plan.label, specialty: SPECIALTY_WORDS[lk.specialty].field,
        setAside: compact.map((d) => ({ name: lk.records.get(d.recordId)!.name, reason: d.customerReason! })),
        fit: fitRec && fitDec ? { name: fitRec.name, detail: fitDetail(fitDec, fitRec, child), note: noteFor(u, fitRec), when: C.whenLabel(existing?.start ?? proposal!.start, tz), booked: !!existing } : null,
        askOffice: fitRec ? [] : ranked.askOffice.map((d) => ({ name: lk.records.get(d.recordId)!.name, reason: d.customerReason! })),
        none: fitRec ? null : lk.answer.ok ? "No doctor in this plan's network nearby yet" : "Not confirmed — directory didn't answer",
      };
    });
    const withFit = rows.filter((r) => r.fit).length;
    const card: C.FamilyMatchCard = {
      view: "family-match", title: `${cap(S.numberWord(rows.length))} people · ${S.numberWord(rows.length)} doctors · ${S.numberWord(rows.length)} plans`, rows,
      footnote: "Times fit your family routine", prompt: proposals.length ? `Say "yes" to book ${proposals.length === 1 ? "it" : proposals.length === 2 ? "both" : `all ${S.numberWord(proposals.length)}`}` : null, booked: false,
    };
    const speech = S.familyReadBack(withFit, rows.length, picks.filter((p) => !p.proposal && !p.existing).map((p) => ({ label: p.lk.member.label, pronoun: p.lk.member.pronoun })));
    return reply("family-match", [speech], card, { people: rows.length, proposals: proposals.map((p) => ({ member: p.memberId, doctor: p.doctorName, start: new Date(p.start).toISOString(), overRoutine: p.overRoutine })) }, steps, false, gateLines(lookups, u));
  });

  // ---------- check_doctor ----------
  server.registerTool("check_doctor", {
    title: "Check one doctor",
    description: "Run the network gate for one doctor from the last search: network, age (office policy) and new patients, each with its source.",
    inputSchema: z.object({ member: memberArg, specialty: specialtyArg, doctor: z.string().trim().min(3).max(80), age_for_this_search: ageArg }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ member: said, specialty, doctor, age_for_this_search }, ctx) => {
    const uid = userIdOf(ctx);
    const steps = new Steps();
    const u = loadUser(uid, seed);
    const gate = consentGate(u, steps, "consent"); if (gate) return gate;
    const m = memberBy(u, said);
    if (!m) return reply(null, ["Who is it for?"], null, {}, steps, true);
    const band = m.role === "child" && age_for_this_search ? parseAgeBand(age_for_this_search) : null;
    const lk = await lookupFor(sv, steps, u, m, specialty, band);
    const d = lk.decisions.find((x) => lk.records.get(x.recordId)!.name.toLowerCase().includes(doctor.toLowerCase().replace(/^dr\.?\s*/, "")));
    if (!d) return reply(null, [`I don't see that doctor in ${lk.plan.label}'s results for ${SPECIALTY_WORDS[specialty].visit}.`], null, {}, steps, true);
    const r = lk.records.get(d.recordId)!;
    const line = d.verdict === "fits" ? `${r.name} fits: ${[d.network.reason, d.age.status === "sees_this_age" ? "sees this age" : null].filter(Boolean).join(", ")}.` : `${r.name}: ${d.customerReason}.`;
    return reply(null, [line], null, { doctor: r.name, decision: d }, steps);
  });

  // ---------- book_visit (SPEC §15: read back, confirm, write) ----------
  registerAppTool(server, "book_visit", {
    title: "Book visits",
    description: "Book the visits from the last proposal (find_in_network or checkup_year). confirm=false reads them back; confirm=true books after the parent said yes. Out-of-network needs book_anyway=true; a time over the family routine needs book_over_routine=true. Lab work is not booked before the primary care visit unless the parent has an order.",
    inputSchema: z.object({
      confirm: z.boolean().default(false),
      book_anyway: z.boolean().default(false).describe("second explicit yes for an out-of-network doctor"),
      book_over_routine: z.boolean().default(false).describe("explicit yes to book over a routine block"),
      item: z.literal("lab_work").optional().describe("ask to book lab work"),
      have_order: z.boolean().default(false).describe("the parent says she already has a lab order"),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { ui: { resourceUri: viewUri("booked") } },
  }, async ({ confirm, book_anyway, book_over_routine, item, have_order }, ctx) => {
    const uid = userIdOf(ctx);
    const steps = new Steps();
    const now = sv.now();
    const u = loadUser(uid, seed);
    const gate = consentGate(u, steps, "booked"); if (gate) return gate;
    const tz = u.profile.timeZone;
    if (item === "lab_work") {
      const adult = u.family.find((m) => m.role === "adult")!;
      const st = labWorkStatus({ now, memberId: adult.memberId, booked: activeVisits(u, now).concat(u.visits.filter((v) => v.status === "booked" && v.end <= now)).map(toBooked), haveOrder: have_order || !!u.checkup?.haveOrder });
      steps.add({ service: "checkup rules", op: "lab work (N10)", mode: "sandbox", ms: 0, summary: st === "ready" ? "order in hand or primary care done" : "waits for the primary care visit" });
      if (st !== "ready") return reply("checkup-year", [S.LAB_NEEDS_ORDER], null, { refused: "N10", item: "lab_work" }, steps, true);
      if (have_order) updateUser(uid, seed, (s) => { if (s.checkup) s.checkup.haveOrder = true; });
      return reply("checkup-year", ["Thanks. Lab booking isn't in this demo yet — your order is noted."], null, { item: "lab_work", ready: true }, steps);
    }
    const pending = u.pending;
    if (!pending || pending.kind !== "book" || !pending.proposals.length) return reply(null, [S.NOTHING_PENDING], null, {}, steps, true);
    const ps = pending.proposals;
    const oon = ps.filter((p) => p.networkStatus !== "in_network");
    if (oon.length && !book_anyway) {
      const m = u.family.find((x) => x.memberId === oon[0].memberId)!;
      return reply(null, [S.outOfNetworkAsk(m.label, m.pronoun)], null, { needsConfirmation: "book_anyway", refused: "N2" }, steps, true);
    }
    const over = ps.filter((p) => p.overRoutine);
    if (over.length && !book_over_routine) return reply(null, [S.overRoutineAsk(over[0].overRoutine!)], null, { needsConfirmation: "book_over_routine", refused: "N12" }, steps, true);
    if (!confirm) {
      const lines = ps.map((p) => `${SPECIALTY_WORDS[p.item as Specialty]?.visit ?? p.item} ${C.whenLabel(p.start, tz)}`);
      return reply(null, [`Booking ${S.numberWord(ps.length)}: ${lines.join("; ")}. Say yes to book.`.replace(/ · /g, " at ")], null, { readBack: true, needsConfirmation: true }, steps);
    }
    // book in the sandbox partner, then confirm in writing (Alexa app card + email, sandbox)
    const booked = updateUser(uid, seed, (s) => {
      const made: Visit[] = [];
      if (pending.from === "checkup_year" && s.checkup) s.checkup.batchFrom = s.visits.length;
      for (const p of ps) {
        const v: Visit = { visitId: `V${s.visits.length + 1}`, memberId: p.memberId, item: p.item, recordId: p.recordId, doctorName: p.doctorName, specialtyLabel: p.specialtyLabel, officeId: p.officeId, officeName: p.officeName, distanceMi: p.distanceMi, start: p.start, end: p.end, status: "booked", bookedAt: now, cancelledAt: null, overRoutine: p.overRoutine, outOfNetworkConfirmed: p.networkStatus !== "in_network", sandboxConfirmation: `SBX-${randomUUID().slice(0, 8).toUpperCase()}` };
        s.visits.push(v);
        made.push(v);
      }
      const lines = made.map((v) => `${C.whenLabel(v.start, tz)} · ${itemField(v.item)} · ${v.doctorName}`);
      s.outbox.push({ at: now, channel: "alexa_app", subject: `Booked · ${made.length} visit${made.length === 1 ? "" : "s"}`, lines, mode: "sandbox" });
      s.outbox.push({ at: now, channel: "email", subject: `Your visits are booked (${made.length})`, lines: [...lines, 'Say "cancel" to Alexa anytime.'], mode: "sandbox" });
      s.pending = null;
      return made;
    });
    // Booking a doctor whose office age policy was unknown: the sandbox office answers, and the answer becomes an
    // office policy (no family data) so the next family is spared the call (SPEC §4.2, demo data).
    const pols = loadPolicies(sv.policiesSeed);
    for (const v of booked) {
      const m = u.family.find((x) => x.memberId === v.memberId);
      if (m?.role !== "child" || pols.some((p) => p.officeId === v.officeId)) continue;
      const ans = sv.scenario.officeAnswer(v.doctorName);
      if (!ans) continue;
      savePolicy({ officeId: v.officeId, minAgeMonths: ans.minAgeMonths, maxAgeMonths: ans.maxAgeMonths, source: "office_confirmed_at_booking", learnedAt: new Date(now).toISOString().slice(0, 10), demo: true }, sv.policiesSeed);
      steps.add({ service: "Office age policies", op: "learned at booking (sandbox office answer)", mode: "sandbox", ms: 0, summary: `${v.officeId}: ${ans.minAgeMonths ?? "?"}–${ans.maxAgeMonths ?? "∞"} months · no family data stored` });
    }
    steps.add({ service: "Sandbox booking partner", op: `book ${booked.length} visit(s)`, mode: "sandbox", ms: 0, summary: booked.map((v) => v.sandboxConfirmation).join(", ") });
    steps.add({ service: "Written confirmation", op: "Alexa app card + email", mode: "sandbox", ms: 0, summary: `${booked.length} visit(s) · sandbox outbox` });
    steps.add({ service: "Family calendar", op: "add visits", mode: "sandbox", ms: 0, summary: `${booked.length} added` });
    const after = loadUser(uid, seed);
    if (pending.from === "find_in_network" && booked.length > 1) {
      // Same screen as the proposal, rows now booked (screen 01 after "yes").
      const rows: C.FamilyRow[] = booked.map((v) => {
        const m = after.family.find((x) => x.memberId === v.memberId)!;
        return { member: C.colorOf(m, after.family), memberLabel: m.label, ageLabel: null, planLabel: planOf(sv, m).label, specialty: itemField(v.item), setAside: [], fit: { name: v.doctorName, detail: `in ${planOf(sv, m).label}'s network`, note: after.notes.find((n) => n.doctorName === v.doctorName)?.text ?? null, when: C.whenLabel(v.start, tz), booked: true }, askOffice: [], none: null };
      });
      const card: C.FamilyMatchCard = { view: "family-match", title: `${cap(S.numberWord(rows.length))} people · ${S.numberWord(rows.length)} doctors · ${S.numberWord(rows.length)} plans`, rows, footnote: "Details sent to your Alexa app and email", prompt: null, booked: true };
      return reply("family-match", [S.BOOKED_SHORT], card, { booked: booked.map((v) => ({ visitId: v.visitId, start: new Date(v.start).toISOString(), confirmation: v.sandboxConfirmation })) }, steps);
    }
    return reply("booked", [S.BOOKED_WRITTEN], bookedCard(sv, after, booked, now), { booked: booked.map((v) => ({ visitId: v.visitId, start: new Date(v.start).toISOString(), confirmation: v.sandboxConfirmation })) }, steps);
  });

  // ---------- cancel_visit ----------
  registerAppTool(server, "cancel_visit", {
    title: "Cancel a visit",
    description: "Cancel a booked visit, also in a later conversation. confirm=false reads it back; confirm=true cancels.",
    inputSchema: z.object({ specialty: z.enum([...SPECIALTIES, "lab_work"] as [string, ...string[]]).optional(), member: memberArg.optional(), confirm: z.boolean().default(false) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    _meta: { ui: { resourceUri: viewUri("booked") } },
  }, async ({ specialty, member, confirm }, ctx) => {
    const uid = userIdOf(ctx);
    const steps = new Steps();
    const now = sv.now();
    const u = loadUser(uid, seed);
    const gate = consentGate(u, steps, "booked"); if (gate) return gate;
    const m = member ? memberBy(u, member) : undefined;
    const cands = activeVisits(u, now).filter((v) => (!specialty || v.item === specialty) && (!m || v.memberId === m.memberId)).sort((a, b) => a.start - b.start);
    if (!cands.length) return reply(null, ["I don't see a booked visit like that."], null, {}, steps, true);
    const target = u.pending?.kind === "cancel" ? cands.find((v) => (u.pending as { visitIds: string[] }).visitIds.includes(v.visitId)) : undefined;
    if (!confirm || !target) {
      updateUser(uid, seed, (s) => { s.pending = { kind: "cancel", visitIds: [cands[0].visitId], at: now }; });
      return reply(null, [S.cancelReadBack(C.visitLabel(cands[0]), cands[0].start, u.profile.timeZone)], null, { readBack: true, needsConfirmation: true, visitId: cands[0].visitId }, steps);
    }
    const after = updateUser(uid, seed, (s) => {
      const v = s.visits.find((x) => x.visitId === target.visitId)!;
      v.status = "cancelled"; v.cancelledAt = now; s.pending = null;
      const line = `${C.whenLabel(v.start, s.profile.timeZone)} · ${itemField(v.item)} · ${v.doctorName}`;
      s.outbox.push({ at: now, channel: "alexa_app", subject: "Cancelled · 1 visit", lines: [line], mode: "sandbox" });
      s.outbox.push({ at: now, channel: "email", subject: "Your visit is cancelled", lines: [line], mode: "sandbox" });
      return s;
    });
    steps.add({ service: "Sandbox booking partner", op: "cancel", mode: "sandbox", ms: 0, summary: target.sandboxConfirmation });
    return reply("booked", [S.CANCELLED], bookedCard(sv, after, [], now), { cancelled: target.visitId }, steps);
  });

  // ---------- checkup_year ----------
  registerAppTool(server, "checkup_year", {
    title: "Checkup year",
    description: "plan: lay out the parent's remaining checkup visits before the plan year resets, around the family routine (read back; book with book_visit). status: what's booked and what's left, from saved state (works in any later conversation). Lab work waits for the primary care visit.",
    inputSchema: z.object({
      action: z.enum(["plan", "status"]),
      items: z.array(z.enum([...SPECIALTIES, "lab_work"] as [string, ...string[]])).min(1).max(8).optional(),
      oop_met: z.boolean().optional().describe("the parent said she has met her out-of-pocket max"),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { ui: { resourceUri: viewUri("visit-plan") } },
  }, async ({ action, items, oop_met }, ctx) => {
    const uid = userIdOf(ctx);
    const steps = new Steps();
    const now = sv.now();
    let u = loadUser(uid, seed);
    const gate = consentGate(u, steps, "visit-plan"); if (gate) return gate;
    const tz = u.profile.timeZone;
    const adult = u.family.find((m) => m.memberId === u.checkup?.memberId) ?? u.family.find((m) => m.role === "adult")!;
    if (oop_met) u = updateUser(uid, seed, (s) => { if (s.checkup) s.checkup.oopMetToldAt = now; return s; });
    const batchFrom = u.checkup?.batchFrom ?? null;
    const earlierThanBatch = (v: Visit) => batchFrom !== null && u.visits.indexOf(v) < batchFrom;
    const allBooked = u.visits.filter((v) => v.status === "booked");

    if (action === "status") {
      const mine = activeVisits(u, now).filter((v) => v.memberId === adult.memberId).sort((a, b) => a.start - b.start);
      const lab = labWorkStatus({ now, memberId: adult.memberId, booked: allBooked.map(toBooked), haveOrder: !!u.checkup?.haveOrder });
      const pcp = mine.find((v) => v.item === "primary_care");
      const items2: C.CheckupYearCard["items"] = mine.map((v) => {
        const earlier = earlierThanBatch(v);
        return { memberLabel: adult.label, member: "mom" as const, item: itemField(v.item), status: earlier ? "booked_earlier" as const : "booked" as const, text: `Booked ${C.whenLabel(v.start, tz).split(" · ")[0]}`, detail: earlier ? "booked earlier" : null };
      });
      items2.push(lab === "ready" ? { memberLabel: adult.label, member: "mom", item: "Lab work", status: "open", text: "Ready to book", detail: null } : { memberLabel: adult.label, member: "mom", item: "Lab work", status: "may_need_order", text: "May need an order", detail: "after your primary care visit" });
      steps.add({ service: "Household state", op: "checkup year (saved across sessions)", mode: "sandbox", ms: 0, summary: `${mine.length} booked · lab work ${lab === "ready" ? "ready" : "waits for primary care"}` });
      const week = C.weekModel({ weekStart: C.mondayOf(mine[0]?.start ?? now, tz), tz, routine: u.routine, window: childAwayWindow(u), visits: mine.map((v) => C.weekVisitOf(v, tz, adult, u.family, earlierThanBatch(v) ? "booked_earlier" : "booked")) });
      const card: C.CheckupYearCard = {
        view: "checkup-year", title: "Your checkup year",
        subtitle: u.checkup?.oopMetToldAt ? `Out-of-pocket max met · plans usually pay 100% of covered in-network care until ${shortDate(u.checkup.planYearEnd)}` : `Plan year ends ${shortDate(u.checkup?.planYearEnd ?? sv.scenario.planYearEnd)}`,
        source: "Source: HealthCare.gov glossary · Check your plan for details", items: items2, week,
      };
      const speech = S.checkupStatus({ booked: mine.length, labWaits: lab !== "ready", labAfterDay: pcp ? weekdayLong(toZoned(pcp.start, tz)) : null, open: [] });
      return reply("checkup-year", [speech], card, { booked: mine.length, lab }, steps);
    }

    // ---- plan ----
    const want = (items ?? (CHECKUP_ORDER.filter((i) => ["primary_care", "ob_gyn", "gastroenterology", "dermatology", "lab_work"].includes(i)) as string[])) as CheckupItem[];
    const candidates = new Map<Specialty, Candidate[]>();
    const lookups = new Map<Specialty, Lookup>();
    for (const it of want) {
      if (it === "lab_work") continue;
      if (activeVisits(u, now).some((v) => v.memberId === adult.memberId && v.item === it)) continue;
      const lk = await lookupFor(sv, steps, u, adult, it as Specialty, null);
      lookups.set(it as Specialty, lk);
      const firstSlot = new Map([...lk.records.values()].map((r) => [r.recordId, slotsOf(sv, r).find((s) => s.start >= now)?.start ?? null]));
      const ranked = rankDecisions(lk.decisions, lk.records, firstSlot);
      candidates.set(it as Specialty, ranked.fits.map((d) => lk.records.get(d.recordId)!).filter((r) => slotsOf(sv, r).length).map((r) => ({ record: r, slots: slotsOf(sv, r) })));
    }
    const lines = steps.sync("checkup planner", "routine gaps · family calendar · same clinic · lab after primary care", "sandbox",
      () => planCheckup({ items: want, memberId: adult.memberId, candidates, booked: allBooked.map(toBooked), routine: u.routine, tz, now, planYearEnd: sv.scenario.planYearEndMs, haveOrder: !!u.checkup?.haveOrder }),
      (ls) => ls.map((l) => `${l.item}:${l.status}`).join(" · "));
    const proposals: Proposal[] = lines.filter((l): l is Extract<CheckupLine, { status: "proposed" }> => l.status === "proposed").map((l) => ({
      memberId: adult.memberId, item: l.item, recordId: l.record.recordId, doctorName: l.record.name, specialtyLabel: l.record.specialtyLabel, officeId: l.record.officeId, officeName: l.record.officeName, distanceMi: l.record.distanceMi, start: l.placement.slot.start, end: l.placement.slot.end, networkStatus: "in_network", overRoutine: l.placement.tier === "over_routine" ? l.placement.conflict : null,
    }));
    updateUser(uid, seed, (s) => { s.pending = proposals.length ? { kind: "book", from: "checkup_year", proposals, at: now } : null; });
    const earlierLines = lines.filter((l): l is Extract<CheckupLine, { status: "booked" }> => l.status === "booked");
    const labWaits = lines.some((l) => l.item === "lab_work" && l.status === "may_need_order");
    const win = childAwayWindow(u);
    const allInWindow = proposals.length > 0 && proposals.every((p) => { const m = minutesOfDay(toZoned(p.start, tz)); return win && m >= win.startMin && m + (p.end - p.start) / 60000 <= win.endMin; });
    const who = childPronounOfRoutine(u);
    const parts = [
      ...(oop_met ? [S.OOP_LINE] : []),
      S.checkupReadBack({ tz, bookedEarlier: earlierLines.map((l) => ({ item: l.item, start: l.visit.start })), proposals: proposals.map((p) => ({ item: p.item as Specialty, start: p.start, end: p.end, officeId: p.officeId })), windowStartMin: allInWindow ? win!.startMin : null, childPronoun: who?.pronoun ?? null, routineLabel: who?.word ?? null, labWaits }),
    ];
    const others = activeVisits(u, now).filter((v) => v.memberId !== adult.memberId);
    const weekVisits = [
      ...proposals.map((p) => C.weekVisitOf(p, tz, adult, u.family, "proposed")),
      ...earlierLines.map((l) => C.weekVisitOf({ start: l.visit.start, end: l.visit.end, item: l.item }, tz, adult, u.family, "booked_earlier")),
      ...others.map((v) => C.weekVisitOf(v, tz, u.family.find((m) => m.memberId === v.memberId)!, u.family, "other_member")),
    ];
    const starts = [...proposals.map((p) => p.start), ...earlierLines.map((l) => l.visit.start)];
    const firstStart = starts.length ? Math.min(...starts) : now + 86400000; // the week of the visits, not of "now"
    const docRows: C.VisitPlanCard["doctors"] = [
      ...proposals.map((p) => { const l = lines.find((x) => x.status === "proposed" && x.item === p.item) as Extract<CheckupLine, { status: "proposed" }>; const d = lookups.get(p.item as Specialty)?.decisions.find((x) => x.recordId === p.recordId); return { start: p.start, row: { specialty: itemField(p.item), name: p.doctorName, when: C.whenLabel(p.start, tz), detail: [d?.network.reason ?? "in network", l.record.newPatients === "accepting" ? "accepting new patients" : null, p.distanceMi !== null ? `${p.distanceMi} mi` : null].filter(Boolean).join(" · "), tag: l.sameClinicWith ? "same clinic" : null, quiet: false } }; }),
      ...earlierLines.map((l) => { const v = u.visits.find((x) => x.recordId === l.visit.recordId && x.start === l.visit.start)!; return { start: v.start, row: { specialty: itemField(v.item), name: v.doctorName, when: C.whenLabel(v.start, tz), detail: [`in ${planOf(sv, adult).label}'s network`, "accepting new patients", v.distanceMi !== null ? `${v.distanceMi} mi` : null].filter(Boolean).join(" · "), tag: "Already booked", quiet: true } }; }),
    ].sort((a, b) => a.start - b.start).map((x) => x.row);
    const card: C.VisitPlanCard = {
      view: "visit-plan", quote: null, title: `Your visits before ${shortDate(u.checkup?.planYearEnd ?? sv.scenario.planYearEnd)}`,
      week: C.weekModel({ weekStart: C.mondayOf(firstStart, tz), tz, routine: u.routine, window: win, visits: weekVisits }),
      doctors: docRows,
      sourceLine: sourceLineOf([...lookups.values()].flatMap((l) => [...l.records.values()])),
      lab: labWaits ? "Lab work — may need an order from your doctor · after your primary care visit" : null,
      prompt: proposals.length ? `Say "yes" to book ${proposals.length === 1 ? "it" : proposals.length === 2 ? "these two" : `these ${S.numberWord(proposals.length)}`}` : null,
    };
    return reply("visit-plan", parts, card, { proposals: proposals.map((p) => ({ item: p.item, doctor: p.doctorName, start: new Date(p.start).toISOString() })), bookedEarlier: earlierLines.map((l) => l.item), labWaits, oopMetTold: !!u.checkup?.oopMetToldAt }, steps);
  });

  // ---------- MCP Apps views ----------
  for (const v of VIEWS) {
    const uri = viewUri(v);
    const ui = { csp: { resourceDomains: assetBase ? [assetBase] : [] }, prefersBorder: false };
    registerAppResource(server, `innetwork-${v}`, uri, { mimeType: RESOURCE_MIME_TYPE, description: `InNetwork ${v} screen (MCP App view)`, _meta: { ui } }, async () => {
      const file = join(ROOT, "dist", "views", `${v}.html`);
      if (!existsSync(file)) throw new Error(`${file} missing - run "npm run build" first`);
      const html = readFileSync(file, "utf8").replaceAll("__INNETWORK_ASSET_BASE__", assetBase);
      return { contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: { ui } }] };
    });
  }
  return server;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (ymd: string) => { const [, m, d] = ymd.split("-").map(Number); return `${MON[m]} ${d}`; };

function bookedCard(sv: Services, u: UserState, made: Visit[], now: number): C.BookedCard {
  const tz = u.profile.timeZone;
  const adult = u.family.find((m) => m.role === "adult");
  const ids = new Set(made.map((v) => v.visitId));
  const mine = activeVisits(u, now).filter((v) => !adult || v.memberId === adult.memberId).sort((a, b) => a.start - b.start);
  const earlier = mine.filter((v) => !ids.has(v.visitId));
  const win = childAwayWindow(u);
  const allIn = made.length > 0 && win && made.every((v) => { const m = minutesOfDay(toZoned(v.start, tz)); return m >= win.startMin && m + (v.end - v.start) / 60000 <= win.endMin; });
  const lastEnd = made.length ? Math.max(...made.map((v) => minutesOfDay(toZoned(v.end, tz)))) : 0;
  const clock = (min: number) => { const h = Math.floor(min / 60), mm = min % 60; return `${h % 12 === 0 ? 12 : h % 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}`; };
  const title = made.length ? `Booked · ${made.length} visit${made.length === 1 ? "" : "s"}` : "Cancelled";
  return {
    view: "booked", title,
    subtitle: allIn && win ? `All between ${clock(win.startMin)} and ${clock(Math.ceil(lastEnd / 60) * 60)}, while ${win.whoPronoun} at ${win.routineWord}` : null,
    list: [...made, ...earlier].map((v) => ({ when: `${C.whenLabel(v.start, tz)}`, label: itemField(v.item), earlier: !ids.has(v.visitId), member: adult ? C.colorOf(adult, u.family) : "mom" })),
    week: mine.length ? C.weekModel({ weekStart: C.mondayOf(mine[0].start, tz), tz, routine: u.routine, window: win, visits: mine.map((v) => C.weekVisitOf(v, tz, adult!, u.family, ids.has(v.visitId) ? "booked" : "booked_earlier")) }) : null,
    notices: [{ icon: "doc", text: "Details sent to your Alexa app and email" }, { icon: "mic", text: 'Say "cancel" anytime' }],
  };
}

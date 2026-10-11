// The network gate: deterministic, no model, no network, no clock. Same inputs -> byte-identical decisions.
// One record + the member's plan + the age band said for this search + the office's learned age policy
// -> fits / set aside / ask the office / not confirmed, each with a reason and its source.
//
// Refusals implemented here (SPEC §3):
//   N2  "in network" only when the record carries one of the plan's network ids; "unknown" is never shown as in network
//   N3  age has three outcomes (sees / does not see / not listed); a doctor with no age data never "fits" a child's search;
//       the taxonomy ("Pediatric ...") never sets a doctor aside on its own
//   N8  directory did not answer -> "not confirmed", never in "fits"
//   N13 ranking never looks at the family's notes (rankDecisions has no notes parameter)
import { yearsOf } from "./age.ts";
import type { AgeBand, Decision, DirectoryRecord, OfficePolicy, Plan } from "./types.ts";

export type Pronoun = "he" | "she" | "they";
const possessive = (p: Pronoun) => (p === "he" ? "his" : p === "she" ? "her" : "their");

export type GateInput = {
  record: DirectoryRecord;
  plan: Plan;
  /** Age band said for THIS search (children's searches); null for an adult or when no age was said. */
  ageBand: AgeBand | null;
  policy: OfficePolicy | null;
  /** false when the plan's directory did not answer for this search (N8). */
  directoryAnswered: boolean;
  /** Pronoun of the member, for the customer-facing reason ("Not in his plan's network"). */
  pronoun?: Pronoun;
};

function policySource(p: OfficePolicy): string {
  const how = p.source === "office_confirmed_at_booking" ? "office policy · learned from a past booking" : "booking partner age groups";
  return p.demo ? `${how} · demo data` : how;
}

function ageOutcome(band: AgeBand | null, policy: OfficePolicy | null): Decision["age"] {
  if (!band) return { status: "not_asked", reason: "no age for this search", source: "—" };
  if (!policy || (policy.minAgeMonths === null && policy.maxAgeMonths === null)) {
    return { status: "age_not_listed", reason: "Age not listed · we'll ask the office when booking", source: "directory has no age field" };
  }
  const lo = policy.minAgeMonths ?? 0;
  const hi = policy.maxAgeMonths ?? Number.POSITIVE_INFINITY;
  const src = policySource(policy);
  if (band.minMonths >= lo && band.maxMonths <= hi) return { status: "sees_this_age", reason: "sees this age", source: src };
  if (band.maxMonths < lo) return { status: "does_not_see_this_age", reason: `Doesn't see children under ${yearsOf(lo)}`, source: src };
  if (band.minMonths > hi) return { status: "does_not_see_this_age", reason: `Doesn't see patients over ${yearsOf(hi + 1)}`, source: src };
  // The band straddles the office's limit: we can't say either way from the data we hold.
  return { status: "age_not_listed", reason: "Age limit is close to this age · we'll ask the office when booking", source: src };
}

export function checkDoctor(input: GateInput): Decision {
  const { record, plan, ageBand, policy, directoryAnswered } = input;
  const pron = input.pronoun ?? "they";
  const dir = `${record.source.directory} · ${record.source.mode} · as of ${record.source.asOf.slice(0, 10)}`;

  let network: Decision["network"];
  if (!directoryAnswered) network = { status: "unknown", reason: "not confirmed — directory didn't answer", source: dir };
  else if (record.networks.some((n) => plan.networkIds.includes(n))) network = { status: "in_network", reason: `in ${plan.label}'s network`, source: dir };
  else network = { status: "out_of_network", reason: `Not in ${possessive(pron)} plan's network`, source: dir };

  const age = ageOutcome(ageBand, policy);
  const newPatients = { status: record.newPatients, source: dir };

  let verdict: Decision["verdict"];
  let customerReason: string | null = null;
  if (network.status === "unknown") { verdict = "not_confirmed"; customerReason = "Not confirmed — directory didn't answer"; }
  else if (network.status === "out_of_network") { verdict = "set_aside"; customerReason = network.reason; }
  else if (record.newPatients === "not_accepting") { verdict = "set_aside"; customerReason = "Not taking new patients"; }
  else if (age.status === "does_not_see_this_age") { verdict = "set_aside"; customerReason = age.reason; }
  else if (age.status === "age_not_listed") { verdict = "ask_office"; customerReason = age.reason; }
  else verdict = "fits";

  const fullReason = customerReason === null ? null
    : verdict === "set_aside" && age.status === "does_not_see_this_age" && customerReason === age.reason ? `${age.reason} · ${age.source.replace("office policy · learned from a past booking", "confirmed by the office at a past booking")}`
    : customerReason;

  return { recordId: record.recordId, verdict, network, age, newPatients, customerReason, fullReason };
}

const REASON_ORDER = (d: Decision) =>
  d.age.status === "does_not_see_this_age" && d.network.status === "in_network" ? 0 : d.network.status === "out_of_network" ? 1 : d.newPatients.status === "not_accepting" ? 2 : 3;

export type Ranked = { fits: Decision[]; setAside: Decision[]; askOffice: Decision[]; notConfirmed: Decision[] };

/**
 * Deterministic order. Fits: nearest first, then earliest offered slot, then name. Set aside: age reasons, then
 * network, then new patients; then distance and name. There is deliberately no notes parameter (N13).
 */
export function rankDecisions(decisions: Decision[], records: Map<string, DirectoryRecord>, firstSlot: Map<string, number | null> = new Map()): Ranked {
  const rec = (d: Decision) => records.get(d.recordId)!;
  const dist = (d: Decision) => rec(d).distanceMi ?? Number.POSITIVE_INFINITY;
  const slot = (d: Decision) => firstSlot.get(d.recordId) ?? Number.POSITIVE_INFINITY;
  const byName = (a: Decision, b: Decision) => rec(a).name.localeCompare(rec(b).name) || a.recordId.localeCompare(b.recordId);
  const fits = decisions.filter((d) => d.verdict === "fits").sort((a, b) => dist(a) - dist(b) || slot(a) - slot(b) || byName(a, b));
  const setAside = decisions.filter((d) => d.verdict === "set_aside").sort((a, b) => REASON_ORDER(a) - REASON_ORDER(b) || dist(a) - dist(b) || byName(a, b));
  const askOffice = decisions.filter((d) => d.verdict === "ask_office").sort((a, b) => dist(a) - dist(b) || byName(a, b));
  const notConfirmed = decisions.filter((d) => d.verdict === "not_confirmed").sort(byName);
  return { fits, setAside, askOffice, notConfirmed };
}

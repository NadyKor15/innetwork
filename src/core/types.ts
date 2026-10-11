// Shared types of the InNetwork core. The core is deterministic (no model, no network, no clock of its own):
// the same inputs give byte-identical decisions. Directory adapters (src/directory) produce DirectoryRecord;
// the gate (network-gate.ts) turns a record + the member's plan + the age band said for this search into a Decision.

/** Where a fact came from. Shown as a badge in the developer view, never on customer cards. */
export type SourceMode = "live" | "file" | "fixture" | "sandbox" | "simulated";

/** Closed list of specialties (N1: the add-on never picks one; the parent names it). */
export const SPECIALTIES = [
  "primary_care", "ob_gyn", "gastroenterology", "dermatology", "allergy", "orthopedics",
  "pediatrics", "cardiology", "ent", "ophthalmology", "urology", "endocrinology",
] as const;
export type Specialty = (typeof SPECIALTIES)[number];

/** A checkup item is a specialty or lab work (lab work is a facility visit that may need an order, N10). */
export type CheckupItem = Specialty | "lab_work";

export type NewPatients = "accepting" | "not_accepting" | "unknown";

/** One practitioner at one office, normalized from a directory (FHIR Plan-Net PractitionerRole, QHP file row, ...). */
export type DirectoryRecord = {
  /** Stable id inside its directory (e.g. "fb:PractitionerRole/123", "qhp:oscar:<hash>", "fx:plan-c:ortho-04"). */
  recordId: string;
  npi: string | null;
  /** Display name as the directory gives it, e.g. "Dr. Imogen Pellworth". */
  name: string;
  specialty: Specialty;
  /** Human label of the taxonomy, e.g. "Pediatric orthopedics". */
  specialtyLabel: string;
  /** Office key: the age policy is a property of the office (SPEC §4.2), shared by every family, no family data. */
  officeId: string;
  officeName: string;
  address: { line: string; city: string; state: string; zip: string };
  /** Straight-line miles from the family's ZIP centroid (null when the directory has no geo). */
  distanceMi: number | null;
  /** Network ids this record belongs to (FHIR: network-reference targets; QHP: HIOS plan ids). */
  networks: string[];
  newPatients: NewPatients;
  source: RecordSource;
};

export type RecordSource = {
  /** Directory label, e.g. "Florida Blue provider directory (FHIR Plan-Net)". */
  directory: string;
  mode: SourceMode;
  /** ISO time the record was fetched (live) or captured (fixture/file). */
  asOf: string;
  /** Request or file the record came from (developer view). */
  ref: string;
  /** For fixtures: what was changed from the captured response ("names changed", ...). Shown on cards (N11). */
  provenance?: string;
};

/** A plan as the add-on knows it. Customer surfaces see only `label` (Plan A/B/C); type and insurer are developer-view only. */
export type Plan = {
  planId: string;
  label: string;
  /** Network id(s) a record must carry to count as in this plan's network. */
  networkIds: string[];
  /** Developer view only (N4: never on customer cards, never in the user's store). */
  dev: { insurer: string; product: string; kind: "fhir-plannet" | "qhp-file" | "fixture"; programType: string; sourceMode: SourceMode };
};

/** Age band the parent says for THIS search only (N4). Never stored. Months, inclusive. */
export type AgeBand = { label: string; minMonths: number; maxMonths: number };

/** Office age policy learned once at a booking (SPEC §4.2). Property of the office; carries no family data. */
export type OfficePolicy = {
  officeId: string;
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
  source: "office_confirmed_at_booking" | "booking_partner_age_groups";
  learnedAt: string;
  /** true for the SANDBOX demo data; every customer line built from it ends with "demo data". */
  demo: boolean;
};

export type NetworkStatus = "in_network" | "out_of_network" | "unknown";
export type AgeStatus = "sees_this_age" | "does_not_see_this_age" | "age_not_listed" | "not_asked";
export type Verdict = "fits" | "set_aside" | "ask_office" | "not_confirmed";

export type Decision = {
  recordId: string;
  verdict: Verdict;
  network: { status: NetworkStatus; reason: string; source: string };
  age: { status: AgeStatus; reason: string; source: string };
  newPatients: { status: NewPatients; source: string };
  /** One short customer-facing reason (set aside / ask office), e.g. "Doesn't see children under 3". */
  customerReason: string | null;
  /** Full reason with its source, for screen 05 and the developer view. */
  fullReason: string | null;
};

/** Directory lookup outcome for one plan+specialty+ZIP: records, or an explicit "did not answer" (N8). */
export type DirectoryAnswer =
  | { ok: true; records: DirectoryRecord[]; mode: SourceMode; directory: string; ms: number; asOf: string; ref: string; inNetworkCount: number | null }
  | { ok: false; error: string; mode: SourceMode; directory: string; ms: number; asOf: string; ref: string };

/** A weekday routine block (N12): label + time only, no names, no addresses. days: 1=Mon..5=Fri. */
export type RoutineBlock = { label: string; days: number[]; start: string; end: string };

export type Slot = { start: number; end: number };

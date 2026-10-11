// TEST DOUBLE of the directory service, for unit tests of the server only. The demo and verify use src/directory
// (recorded samples + live adapters). Records here mirror the demo cast so tool tests can run offline and fast.
import type { DirectoryAnswer, DirectoryRecord, DirectoryService, Plan, Specialty } from "../src/core/types.ts";

const plans: Plan[] = [
  { planId: "plan-a", label: "Plan A", networkIds: ["NET-A"], dev: { insurer: "test insurer A", product: "test product", kind: "fhir-plannet", programType: "individual", sourceMode: "fixture" } },
  { planId: "plan-b", label: "Plan B", networkIds: ["NET-B"], dev: { insurer: "test insurer B", product: "test product", kind: "qhp-file", programType: "marketplace", sourceMode: "fixture" } },
  { planId: "plan-c", label: "Plan C", networkIds: ["NET-C"], dev: { insurer: "test insurer C", product: "test product", kind: "fixture", programType: "state program", sourceMode: "fixture" } },
];
const src = { directory: "test double", mode: "fixture" as const, asOf: "2026-10-11T00:00:00Z", ref: "server/dev-directory.ts", provenance: "test double" };
const r = (id: string, name: string, specialty: Specialty, label: string, office: string, dist: number, networks: string[]): DirectoryRecord =>
  ({ recordId: id, npi: null, name, specialty, specialtyLabel: label, officeId: office, officeName: `Office ${office}`, address: { line: "1 Test St", city: "Orlando", state: "FL", zip: "32801" }, distanceMi: dist, networks, newPatients: "accepting", source: src });

const RECORDS: DirectoryRecord[] = [
  r("t:pcp", "Dr. Rowena Thistlewood", "primary_care", "Primary care", "clinic-1", 2.1, ["NET-A"]),
  r("t:ob", "Dr. Linnea Marchbank", "ob_gyn", "OB-GYN", "clinic-1", 2.1, ["NET-A"]),
  r("t:gi", "Dr. Marisol Venterra", "gastroenterology", "Gastroenterology", "gi-1", 3.4, ["NET-A"]),
  r("t:derm", "Dr. Ottilie Brennagh", "dermatology", "Dermatology", "derm-1", 1.6, ["NET-A"]),
  r("t:allergy", "Dr. Ansel Quillfeather", "allergy", "Allergy", "allergy-1", 2.8, ["NET-B"]),
  r("t:ped-ortho", "Dr. Imogen Pellworth", "orthopedics", "Pediatric orthopedics", "ortho-1", 1.9, ["NET-C"]),
  r("t:ortho-2", "Dr. Corwin Pembrook", "orthopedics", "Orthopedics", "ortho-2", 3.1, ["NET-C"]),
  r("t:ortho-3", "Dr. Tobias Wrenfield", "orthopedics", "Orthopedics", "ortho-3", 1.2, ["NET-C"]),
  r("t:ortho-4", "Dr. Percival Ashgrove", "orthopedics", "Orthopedics", "ortho-4", 2.4, ["NET-C"]),
  r("t:ortho-5", "Dr. Caspian Ardley", "orthopedics", "Orthopedics", "ortho-5", 1.5, ["NET-A"]),
  r("t:ortho-6", "Dr. Wendeline Hartsworth", "orthopedics", "Orthopedics", "ortho-6", 2.7, ["NET-C"]),
];
export const DEV_POLICIES = [
  { officeId: "ortho-1", minAgeMonths: 0, maxAgeMonths: 215, source: "office_confirmed_at_booking" as const, learnedAt: "2026-09-02", demo: true },
  { officeId: "ortho-2", minAgeMonths: 0, maxAgeMonths: null, source: "office_confirmed_at_booking" as const, learnedAt: "2026-09-14", demo: true },
  { officeId: "ortho-3", minAgeMonths: 36, maxAgeMonths: null, source: "office_confirmed_at_booking" as const, learnedAt: "2026-08-21", demo: true },
  { officeId: "ortho-4", minAgeMonths: 36, maxAgeMonths: null, source: "office_confirmed_at_booking" as const, learnedAt: "2026-09-30", demo: true },
  { officeId: "allergy-1", minAgeMonths: 24, maxAgeMonths: 215, source: "office_confirmed_at_booking" as const, learnedAt: "2026-09-09", demo: true },
];

export function devDirectory(opts: { failFor?: string[] } = {}): DirectoryService {
  return {
    mode: "fixture",
    plans,
    async lookup(plan, specialty, zip): Promise<DirectoryAnswer> {
      const ref = `test:${plan.planId}:${specialty}:${zip}`;
      if (opts.failFor?.includes(plan.planId)) return { ok: false, error: "timeout (test)", mode: "fixture", directory: "test double", ms: 6000, asOf: src.asOf, ref };
      // A directory lists practitioners of all its networks; the gate decides membership.
      const records = RECORDS.filter((x) => x.specialty === specialty);
      return { ok: true, records, mode: "fixture", directory: "test double", ms: 1, asOf: src.asOf, ref, inNetworkCount: records.filter((x) => x.networks.some((n) => plan.networkIds.includes(n))).length };
    },
  };
}

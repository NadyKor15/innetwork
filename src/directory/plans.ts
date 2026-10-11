// The three plans of the demo family. Customer surfaces see only `label` (Plan A/B/C); `dev` is developer view only
// (N4: never on cards, never in the household store). Every id below was read from the live source on 2026-10-11.
//
// Plan A  Florida Blue "BlueChoice" (PPO), FHIR Plan-Net. InsurancePlan/8139749 (identifier BCHPPO-2026) lists network
//         Organization/8139751 = "PPC-2026-BCHPPO", and practitioner roles carry the same network-reference: the whole
//         chain plan -> network -> practitioner holds. (For "BlueOptions" (BOPT) it does not: the plan lists
//         NWBOPTONE-2026-BOPT, while every BOPT role we read points at NWB-2026-BOPT — see docs/FRICTION-LOG.md.)
// Plan B  Oscar Health (Florida) "Silver Classic Standard", HIOS 21525FL0010009, marketplace (QHP). No API: the
//         network is the plan id inside the issuer's machine-readable providers file (CMS index
//         https://d3ul0st9g52g6o.cloudfront.net/ffm/cms-data-index.json).
// Plan C  Molina Healthcare of Florida, Medicaid "Managed Medical Assistance (MMA)". Network Organization "15"
//         (profile plannet-Network, name "Medicaid-Managed Medical Assistance (MMA)") is carried by practitioner roles
//         as network-reference; the InsurancePlan FL-QMXBP1516 "MANAGED MEDICAL ASSISTANCE (MMA) BENEFIT PLAN" exists
//         but its `network` is empty, so plan -> network is linked by the program name, not by a reference.
import type { Plan } from "../core/types.ts";

export const FLORIDA_BLUE_PLAN_ID_SYSTEM = "https://www.edifecs.com/fhir/cms-organization/plan_id";

export type PlanSource =
  | { kind: "fhir-plannet"; directory: "florida-blue"; planCode: string; insurancePlan: string }
  | { kind: "fhir-plannet"; directory: "molina"; network: string; insurancePlan: string }
  | { kind: "qhp-file"; indexUrl: string; hiosPlanId: string; providerFiles: string[] };

export const PLANS: Plan[] = [
  {
    planId: "plan-a",
    label: "Plan A",
    networkIds: ["PPC-2026-BCHPPO"],
    dev: { insurer: "Florida Blue", product: "BlueChoice (PPO) · plan_id BCHPPO · network PPC-2026-BCHPPO", kind: "fhir-plannet", programType: "commercial PPO", sourceMode: "live" },
  },
  {
    planId: "plan-b",
    label: "Plan B",
    networkIds: ["21525FL0010009"],
    dev: { insurer: "Oscar Health (Florida)", product: "Silver Classic Standard · HIOS 21525FL0010009", kind: "qhp-file", programType: "marketplace (ACA) plan", sourceMode: "file" },
  },
  {
    planId: "plan-c",
    label: "Plan C",
    networkIds: ["molina:15"],
    dev: { insurer: "Molina Healthcare of Florida", product: "Medicaid Managed Medical Assistance (MMA) · network 15", kind: "fhir-plannet", programType: "state program (Medicaid managed care)", sourceMode: "live" },
  },
];

export const PLAN_SOURCES: Record<string, PlanSource> = {
  "plan-a": { kind: "fhir-plannet", directory: "florida-blue", planCode: "BCHPPO", insurancePlan: "InsurancePlan/8139749" },
  "plan-b": {
    kind: "qhp-file",
    indexUrl: "https://d3ul0st9g52g6o.cloudfront.net/ffm/cms-data-index.json",
    hiosPlanId: "21525FL0010009",
    // The three providers files that carry Oscar's Florida plans (read in full on 2026-10-11: 233,162 / 233,769 / 233,533 records).
    providerFiles: [
      "https://d3ul0st9g52g6o.cloudfront.net/ffm/providers_5.json",
      "https://d3ul0st9g52g6o.cloudfront.net/ffm/providers_4.json",
      "https://d3ul0st9g52g6o.cloudfront.net/ffm/providers_3.json",
    ],
  },
  "plan-c": { kind: "fhir-plannet", directory: "molina", network: "15", insurancePlan: "InsurancePlan/FL-QMXBP1516" },
};

export const planById = (planId: string): Plan | undefined => PLANS.find((p) => p.planId === planId);

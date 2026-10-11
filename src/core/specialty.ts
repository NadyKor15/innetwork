// Words for the closed specialty list: the field ("Gastroenterology", on screens), the visit ("primary care", in speech)
// and the person ("gastroenterologist"). Plus the words a parent uses for them (host intent matching, N1).
import type { CheckupItem, Specialty } from "./types.ts";

type Words = { field: string; visit: string; person: string; said: RegExp };
export const SPECIALTY_WORDS: Record<Specialty, Words> = {
  primary_care: { field: "Primary care", visit: "primary care", person: "primary care doctor", said: /\b(primary care|family doctor|pcp|general practitioner|internist)\b/i },
  ob_gyn: { field: "OB-GYN", visit: "OB-GYN", person: "OB-GYN", said: /\b(ob[- ]?gyn|obgyn|gyn(a)?ecologist|obstetrician)\b/i },
  gastroenterology: { field: "Gastroenterology", visit: "gastroenterology", person: "gastroenterologist", said: /\bgastroenterolog(ist|y)\b|\bgi doctor\b/i },
  dermatology: { field: "Dermatology", visit: "dermatology", person: "dermatologist", said: /\bdermatolog(ist|y)\b|\bskin doctor\b/i },
  allergy: { field: "Allergy", visit: "allergy", person: "allergist", said: /\ballergist\b|\ballergy doctor\b/i },
  orthopedics: { field: "Orthopedics", visit: "orthopedics", person: "orthopedist", said: /\borthop(a)?edi(st|cs|c surgeon|c doctor)\b/i },
  pediatrics: { field: "Pediatrics", visit: "pediatrics", person: "pediatrician", said: /\bpediatrician\b|\bpaediatrician\b/i },
  cardiology: { field: "Cardiology", visit: "cardiology", person: "cardiologist", said: /\bcardiolog(ist|y)\b|\bheart doctor\b/i },
  ent: { field: "Ear, nose and throat", visit: "ENT", person: "ENT doctor", said: /\bent\b|\bear,? nose(,| and) throat\b|\botolaryngolog(ist|y)\b/i },
  ophthalmology: { field: "Ophthalmology", visit: "eye care", person: "eye doctor", said: /\bophthalmolog(ist|y)\b|\beye doctor\b/i },
  urology: { field: "Urology", visit: "urology", person: "urologist", said: /\burolog(ist|y)\b/i },
  endocrinology: { field: "Endocrinology", visit: "endocrinology", person: "endocrinologist", said: /\bendocrinolog(ist|y)\b/i },
};

export const itemField = (i: CheckupItem) => (i === "lab_work" ? "Lab work" : SPECIALTY_WORDS[i].field);
export const itemVisit = (i: CheckupItem) => (i === "lab_work" ? "lab work" : SPECIALTY_WORDS[i].visit);

/** Specialties named in a phrase, in the order they are said. */
export function specialtiesIn(text: string): { specialty: Specialty; at: number }[] {
  const out: { specialty: Specialty; at: number }[] = [];
  for (const [k, w] of Object.entries(SPECIALTY_WORDS) as [Specialty, Words][]) {
    const m = w.said.exec(text);
    if (m) out.push({ specialty: k, at: m.index });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Canonical order of a checkup (primary care first: lab orders come from it, N10). */
export const CHECKUP_ORDER: CheckupItem[] = ["primary_care", "ob_gyn", "gastroenterology", "dermatology", "allergy", "cardiology", "ophthalmology", "ent", "urology", "endocrinology", "orthopedics", "pediatrics", "lab_work"];

// Our closed specialty list (src/core/types.ts SPECIALTIES) mapped to NUCC taxonomy codes and the words directories
// use. The table itself lives in the open-source package (packages/plannet-directory-check) so the audit and the
// add-on read the same mapping; this file pins it to our Specialty type and adds card labels per NUCC code.
import { groupOfText, matchesGroup, SPECIALTY_GROUPS, type SpecialtyGroup } from "../../packages/plannet-directory-check/src/specialties.ts";
import type { Specialty } from "../core/types.ts";

export const SPECIALTY_TAXONOMY: Record<Specialty, SpecialtyGroup> = SPECIALTY_GROUPS;

/** Card label per NUCC code ("Pediatric orthopedics" for 207XP3100X); falls back to the group's field name. */
export const NUCC_LABELS: Record<string, string> = {
  "207Q00000X": "Family medicine",
  "207QA0505X": "Family medicine (adult)",
  "207QG0300X": "Family medicine (geriatric)",
  "208D00000X": "General practice",
  "207V00000X": "Obstetrics & gynecology",
  "207VG0400X": "Gynecology",
  "207VX0000X": "Obstetrics",
  "207VM0101X": "Maternal & fetal medicine",
  "207VF0040X": "Urogynecology",
  "207RG0100X": "Gastroenterology",
  "207N00000X": "Dermatology",
  "207NP0225X": "Pediatric dermatology",
  "207NS0135X": "Procedural dermatology",
  "207ND0101X": "Mohs surgery",
  "207NI0002X": "Dermatological immunology",
  "207K00000X": "Allergy & immunology",
  "207KA0200X": "Allergy",
  "207KI0005X": "Clinical & laboratory immunology",
  "207RA0201X": "Allergy & immunology",
  "2080P0201X": "Pediatric allergy & immunology",
  "207X00000X": "Orthopedics",
  "207XP3100X": "Pediatric orthopedics",
  "207XS0106X": "Orthopedics (hand)",
  "207XS0114X": "Orthopedics (adult reconstruction)",
  "207XS0117X": "Orthopedics (spine)",
  "207XX0004X": "Orthopedics (foot and ankle)",
  "207XX0005X": "Orthopedics (sports medicine)",
  "207XX0801X": "Orthopedics (trauma)",
  "208000000X": "Pediatrics",
  "207RC0000X": "Cardiology",
  "207RI0011X": "Interventional cardiology",
  "207RC0001X": "Cardiac electrophysiology",
  "2080P0202X": "Pediatric cardiology",
  "207Y00000X": "Ear, nose and throat",
  "207YP0228X": "Pediatric ear, nose and throat",
  "207YS0123X": "Facial plastic surgery",
  "207YX0007X": "Head and neck surgery",
  "207W00000X": "Ophthalmology",
  "207WX0110X": "Pediatric ophthalmology",
  "208800000X": "Urology",
  "2088P0231X": "Pediatric urology",
  "207RE0101X": "Endocrinology",
};

/** Does a directory record's specialty (NUCC codes and/or free text) belong to our specialty? */
export function isSpecialty(s: Specialty, codes: string[], texts: string[]): boolean {
  return matchesGroup(s, codes, texts) || texts.some((t) => groupOfText(t) === s);
}

const sentence = (s: string) => { const l = s.trim().toLowerCase(); return l.charAt(0).toUpperCase() + l.slice(1); };

/** Card label: the most specific NUCC code we know, else the directory's own text in sentence case, else the field. */
export function specialtyLabel(s: Specialty, codes: string[], texts: string[]): string {
  const specific = codes.filter((c) => SPECIALTY_TAXONOMY[s].nucc.includes(c)).sort((a, b) => (b.endsWith("00000X") ? -1 : 0) - (a.endsWith("00000X") ? -1 : 0));
  if (specific.length) return NUCC_LABELS[specific[0]] ?? SPECIALTY_TAXONOMY[s].label;
  const t = texts.find((x) => groupOfText(x) === s || matchesGroup(s, [], [x]));
  if (t) return sentence(t);
  return SPECIALTY_TAXONOMY[s].label;
}

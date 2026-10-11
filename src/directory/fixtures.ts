// Recorded samples (fixtures/directory/<plan>.<specialty>.json + .meta.json): real directory answers with names and
// offices replaced (see scripts/fixtures-capture.ts). They are normalized by the SAME code as live answers
// (records.ts normalizeRole -> florida-blue/molina toRecord, qhp-file qhpToRecords), then marked mode "fixture" with
// the provenance line the card shows (N11).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FhirResource } from "../../packages/plannet-directory-check/src/fhir.ts";
import { normalizeRole } from "../../packages/plannet-directory-check/src/records.ts";
import { referenceList } from "../../packages/plannet-directory-check/src/plannet.ts";
import type { QhpProvider } from "../../packages/plannet-directory-check/src/qhp.ts";
import type { DirectoryRecord, Specialty } from "../core/types.ts";
import { FB_LABEL, toRecord as fbToRecord } from "./florida-blue.ts";
import { MOLINA_LABEL, molinaToRecord } from "./molina.ts";
import { QHP_LABEL, qhpToRecords } from "./qhp-file.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIXTURE_DIR = join(ROOT, "fixtures", "directory");

/** ZIPs the recorded samples stand for (central Orlando around the demo ZIP). Other ZIPs get no sample. */
export const FIXTURE_ZIPS = ["32801", "32803", "32804", "32806"];

export type FixtureMeta = {
  planId: string;
  specialty: Specialty;
  capturedAt: string;
  zip: string;
  source: { directory: string; request: string; [k: string]: unknown };
  realFieldsKept: string[];
  changed: string[];
  provenance: string;
  distances: Record<string, number>;
  nppesTaxonomy?: Record<string, string[]>;
  /** Per-record provenance when one record changed more than the file's default line says. */
  provenanceByRole?: Record<string, string>;
};
type FixtureBody =
  | { planId: string; specialty: Specialty; zip: string; format: "fhir-bundle"; directory: "florida-blue"; networkIndex: Record<string, string>; data: { entry: { search?: { mode?: string }; resource: FhirResource }[] } }
  | { planId: string; specialty: Specialty; zip: string; format: "qhp-providers"; directory: "oscar-qhp"; data: QhpProvider[] }
  | { planId: string; specialty: Specialty; zip: string; format: "fhir-roles-per-location"; directory: "molina"; data: { locations: FhirResource[]; roles: FhirResource[] } };

export type LoadedFixture = { records: DirectoryRecord[]; meta: FixtureMeta; directory: string; file: string };

export const fixturePath = (planId: string, specialty: Specialty, dir = FIXTURE_DIR) => join(dir, `${planId}.${specialty}.json`);

/** Office key for fixture records: "fx:office:a1" (same office => same id, e.g. primary care + OB-GYN "same clinic"). */
const fxOffice = (locId: string) => `fx:office:${locId.replace(/^.*office-/, "")}`;

export function loadFixture(planId: string, specialty: Specialty, dir = FIXTURE_DIR): LoadedFixture | null {
  const file = fixturePath(planId, specialty, dir);
  if (!existsSync(file)) return null;
  const body = JSON.parse(readFileSync(file, "utf8")) as FixtureBody;
  const meta = JSON.parse(readFileSync(file.replace(/\.json$/, ".meta.json"), "utf8")) as FixtureMeta;
  const asOf = meta.capturedAt;
  const ref = `${meta.source.request} (recorded sample, ${file.slice(ROOT.length + 1)})`;
  const mark = (r: DirectoryRecord, roleKey: string, locId: string | null): DirectoryRecord => ({
    ...r,
    recordId: `fx:${planId}:${roleKey.replace(/^.*\//, "")}`,
    officeId: locId ? fxOffice(locId) : r.officeId,
    distanceMi: meta.distances[roleKey] ?? meta.distances["*"] ?? null,
    source: { directory: r.source.directory, mode: "fixture", asOf, ref, provenance: meta.provenanceByRole?.[roleKey] ?? meta.provenance },
  });
  let records: DirectoryRecord[] = [];
  let directory = "";
  if (body.format === "fhir-bundle") {
    directory = FB_LABEL;
    const entries = body.data.entry ?? [];
    const included = new Map(entries.filter((e) => e.search?.mode === "include").map((e) => [`${e.resource.resourceType}/${e.resource.id}`, e.resource]));
    const netIndex = new Map(Object.entries(body.networkIndex));
    for (const e of entries.filter((x) => x.search?.mode === "match")) {
      const role = e.resource;
      const loc = referenceList(role, "location").map((x) => included.get(x)).find(Boolean) ?? null;
      const prac = included.get(((role as { practitioner?: { reference?: string } }).practitioner?.reference) ?? "") ?? null;
      const n = normalizeRole("florida-blue", role, loc, prac);
      const extra = meta.nppesTaxonomy?.[n.roleId] ?? [];
      const rec = fbToRecord({ ...n, specialtyCodes: [...new Set([...n.specialtyCodes, ...extra])] }, specialty, netIndex, asOf, ref);
      records.push(mark(rec, n.roleId, loc?.id ?? null));
    }
  } else if (body.format === "qhp-providers") {
    directory = QHP_LABEL;
    const all = body.data.flatMap((p) => qhpToRecords(p, specialty, null, { asOf, ref, mode: "fixture" }));
    // One office per provider address in the file; fixture offices are numbered b1, b2, ...
    records = all.map((r, i) => ({ ...mark(r, "*", null), recordId: `fx:${planId}:${i + 1}`, officeId: `fx:office:b${i + 1}` }));
  } else if (body.format === "fhir-roles-per-location") {
    directory = MOLINA_LABEL;
    const locs = new Map(body.data.locations.map((l) => [`Location/${l.id}`, l]));
    for (const role of body.data.roles) {
      const loc = referenceList(role, "location").map((x) => locs.get(x)).find(Boolean) ?? null;
      const n = normalizeRole("molina", role, loc, null);
      records.push(mark(molinaToRecord(n, specialty, asOf, ref), n.roleId, loc?.id ?? null));
    }
  }
  records.sort((a, b) => a.name.localeCompare(b.name) || a.recordId.localeCompare(b.recordId));
  return { records, meta, directory, file };
}

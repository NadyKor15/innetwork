// Plan C live adapter: Molina Healthcare provider directory (FHIR Plan-Net, public, no key), Florida Medicaid
// "Managed Medical Assistance (MMA)" network (network Organization "15").
// The server supports PractitionerRole?network=&location= but only ONE location id per request (comma lists return 0)
// and no chained search, so a ZIP is answered as: Location?address-postalcode=Z, then one PractitionerRole request
// per location, paced (bursts of parallel requests got HTTP 403 on 2026-10-11).
import { Counters, type FetchLike } from "../../packages/plannet-directory-check/src/http.ts";
import { FhirClient, FhirError } from "../../packages/plannet-directory-check/src/fhir.ts";
import { directoryByKey } from "../../packages/plannet-directory-check/src/directories.ts";
import { rolesInZip, type NormalizedRole } from "../../packages/plannet-directory-check/src/records.ts";
import type { DirectoryAnswer, DirectoryRecord, Specialty } from "../core/types.ts";
import { isSpecialty, specialtyLabel } from "./specialties.ts";

export const MOLINA = directoryByKey("molina");
export const MOLINA_LABEL = MOLINA.label;

/** Molina network references are bare ids ("15"); we namespace them so they never collide with another directory's ids. */
export const molinaNetworkId = (ref: string) => `molina:${ref.replace(/^Organization\//, "")}`;

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

export function molinaToRecord(r: NormalizedRole, specialty: Specialty, asOf: string, ref: string): DirectoryRecord {
  const loc = r.location;
  return {
    recordId: `molina:${r.roleId}`,
    npi: r.npi,
    name: r.name ? `Dr. ${titleCase(r.name)}` : "Name not given",
    specialty,
    specialtyLabel: specialtyLabel(specialty, r.specialtyCodes, r.specialtyTexts),
    officeId: loc ? `molina:${loc.ref}` : `molina:${r.roleId}:office`,
    officeName: loc?.name ? titleCase(loc.name) : "Office in directory",
    address: loc ? { line: loc.line, city: titleCase(loc.city), state: loc.state, zip: loc.zip } : { line: "", city: "", state: "", zip: "" },
    distanceMi: null,
    networks: r.networks.map(molinaNetworkId),
    newPatients: r.accepting,
    source: { directory: MOLINA_LABEL, mode: "live", asOf, ref },
  };
}

export type MolinaOptions = { timeoutMs?: number; fetchImpl?: FetchLike; counters?: Counters; maxLocations?: number; deadlineMs?: number };

/** Plan C lookup (slow: one request per location). Never throws: failure -> ok:false (N8). */
export async function lookupMolina(q: { specialty: Specialty; zip: string; network: string; networkIds: string[] }, opts: MolinaOptions = {}): Promise<DirectoryAnswer> {
  const t0 = performance.now();
  const asOf = new Date().toISOString();
  const counters = opts.counters ?? new Counters();
  const client = new FhirClient(MOLINA.base, { timeoutMs: opts.timeoutMs ?? 6000, fetchImpl: opts.fetchImpl, counters });
  const ref = client.url("Location", { "address-postalcode": q.zip });
  try {
    const res = await rolesInZip(MOLINA, client, { zip: q.zip, network: q.network, maxLocations: opts.maxLocations ?? 120, deadlineMs: opts.deadlineMs });
    if (res.deadlineHit) {
      // A partial count is not a count: report it as not answered (N8) with how far we got.
      return { ok: false, error: `deadline ${opts.deadlineMs} ms: asked ${res.locationsAsked} of ${res.locationsSeen} locations (one request per location)`, mode: "live", directory: MOLINA_LABEL, ms: Math.round(performance.now() - t0), asOf, ref };
    }
    const records = res.roles.filter((r) => isSpecialty(q.specialty, r.specialtyCodes, r.specialtyTexts)).map((r) => molinaToRecord(r, q.specialty, asOf, `${ref} -> PractitionerRole?location=<id>&network=${q.network}`));
    const failed = res.failures.length;
    if (failed > 0 && res.locationsSeen > 0 && failed >= res.locationsSeen) {
      return { ok: false, error: `all ${failed} per-location requests failed (${res.failures[0]})`, mode: "live", directory: MOLINA_LABEL, ms: Math.round(performance.now() - t0), asOf, ref };
    }
    const inNet = new Set(records.filter((r) => r.networks.some((n) => q.networkIds.includes(n))).map((r) => r.npi ?? r.recordId));
    return { ok: true, records, mode: "live", directory: MOLINA_LABEL, ms: Math.round(performance.now() - t0), asOf, ref: failed ? `${ref} (${failed} of ${res.locationsSeen} location requests failed)` : ref, inNetworkCount: inNet.size };
  } catch (err) {
    const msg = err instanceof FhirError ? `${err.kind}${err.status ? ` ${err.status}` : ""}: ${err.message}` : (err as Error)?.message ?? String(err);
    return { ok: false, error: msg, mode: "live", directory: MOLINA_LABEL, ms: Math.round(performance.now() - t0), asOf, ref };
  }
}

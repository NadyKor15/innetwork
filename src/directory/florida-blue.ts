// Plan A live adapter: Florida Blue provider directory (FHIR Plan-Net, public, no key).
// "Practitioners of specialty S at locations in ZIP Z in the network of plan P":
//   1. PractitionerRole?location.address-postalcode=Z&identifier=<plan_id system>|<code>&specialty:text=<text>
//      &_include=PractitionerRole:location&_include=PractitionerRole:practitioner   (server-side; chained search works,
//      the Plan-Net `network` search parameter is NOT supported by this server)
//   2. keep roles whose network-reference resolves (Organization?type=ntwk) to one of the plan's network ids
//   3. sub-specialties the directory files under the classification (gastroenterology is "INTERNAL MEDICINE" there)
//      are confirmed by NPI against NPPES (taxonomy 207RG0100X at a LOCATION address)
// Live records carry real names and ONLY directory fields (N11): no slots, no age policy, no notes.
import { Counters, type FetchLike } from "../../packages/plannet-directory-check/src/http.ts";
import { FhirClient, FhirError } from "../../packages/plannet-directory-check/src/fhir.ts";
import { directoryByKey } from "../../packages/plannet-directory-check/src/directories.ts";
import { rolesInZip, type NormalizedRole } from "../../packages/plannet-directory-check/src/records.ts";
import { nppesSearch, npisWithTaxonomyInZip } from "../../packages/plannet-directory-check/src/nppes.ts";
import type { DirectoryAnswer, DirectoryRecord, Specialty } from "../core/types.ts";
import { FLORIDA_BLUE_PLAN_ID_SYSTEM } from "./plans.ts";
import { isSpecialty, SPECIALTY_TAXONOMY, specialtyLabel } from "./specialties.ts";

export const FB = directoryByKey("florida-blue");
export const FB_LABEL = FB.label;

export type FbOptions = { timeoutMs?: number; fetchImpl?: FetchLike; counters?: Counters; maxPages?: number; keepRaw?: boolean; withNames?: boolean };

/** Network Organization reference -> its identifier ("Organization/8139751" -> "PPC-2026-BCHPPO"). Cached per process. */
let networkIndexCache: { at: number; map: Map<string, string> } | null = null;
export async function networkIndex(client: FhirClient): Promise<Map<string, string>> {
  if (networkIndexCache && Date.now() - networkIndexCache.at < 6 * 3600_000) return networkIndexCache.map;
  const res = await client.search("Organization", { type: "http://hl7.org/fhir/us/davinci-pdex-plan-net/CodeSystem/OrgTypeCS|ntwk", _count: "200" }, 3);
  const map = new Map<string, string>();
  for (const o of res.matches) {
    const ids = ((o as { identifier?: { use?: string; value?: string }[] }).identifier ?? []);
    const official = ids.find((i) => i.use === "official")?.value ?? ids[0]?.value ?? (o as { name?: string }).name;
    if (o.id && official) map.set(`Organization/${o.id}`, official);
  }
  networkIndexCache = { at: Date.now(), map };
  return map;
}
export const _resetNetworkIndexCache = () => { networkIndexCache = null; };

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
const displayName = (raw: string | null): string => {
  if (!raw) return "Name not given";
  const clean = raw.replace(/,?\s+(MD|DO|M\.D\.|D\.O\.)\.?$/i, "").trim();
  return `Dr. ${titleCase(clean)}`;
};

/** `specialty:text` words that match Florida Blue's own vocabulary (measured; kept in the package's directory table). */
export const FB_TEXTS = FB.specialtySearch as Record<Specialty, string[]>;

export type FbLookup = { specialty: Specialty; zip: string; planCode: string; networkIds: string[] };

/** Roles of the specialty in the ZIP for the plan code, NPPES-confirmed where the directory only has the classification. */
async function fbRoles(q: FbLookup, client: FhirClient, opts: FbOptions): Promise<{ roles: NormalizedRole[]; ref: string; nppesRef: string | null }> {
  const group = SPECIALTY_TAXONOMY[q.specialty];
  const texts = FB_TEXTS[q.specialty];
  const all = new Map<string, NormalizedRole>();
  let ref = "";
  const dir = opts.withNames === false ? { ...FB, includes: false } : FB;
  for (const text of texts) {
    const res = await rolesInZip(dir, client, { zip: q.zip, identifier: `${FLORIDA_BLUE_PLAN_ID_SYSTEM}|${q.planCode}`, specialtyText: text, maxPages: opts.maxPages ?? 15, keepRaw: opts.keepRaw });
    if (!ref) ref = res.ref;
    for (const r of res.roles) {
      // specialty:text is a "contains words" match on the server; re-check exactly on our side.
      if (group.needsTaxonomyJoin ? r.specialtyTexts.some((t) => t.toUpperCase() === "INTERNAL MEDICINE") : isSpecialty(q.specialty, r.specialtyCodes, r.specialtyTexts)) all.set(r.roleId, r);
    }
  }
  if (!group.needsTaxonomyJoin) return { roles: [...all.values()], ref, nppesRef: null };
  // Join on NPI with NPPES: practitioners whose NPPES taxonomy is the sub-specialty.
  const keep = new Set<string>();
  const httpOpts = { timeoutMs: opts.timeoutMs, fetchImpl: opts.fetchImpl, counters: opts.counters };
  const inZip = await npisWithTaxonomyInZip(group.nppesTerm, group.nucc, q.zip, httpOpts);
  for (const n of inZip.npis) keep.add(n);
  const rest = [...new Set([...all.values()].map((r) => r.npi).filter((n): n is string => Boolean(n) && !keep.has(n!)))];
  if (rest.length <= 30) {
    for (const npi of rest) {
      const { results } = await nppesSearch({ number: npi }, httpOpts);
      if (results.some((x) => x.taxonomies.some((t) => group.nucc.includes(t.code)))) keep.add(npi);
    }
  }
  const roles = [...all.values()].filter((r) => r.npi && keep.has(r.npi)).map((r) => ({ ...r, specialtyCodes: [...new Set([...r.specialtyCodes, ...group.nucc.slice(0, 1)])] }));
  return { roles, ref, nppesRef: inZip.url };
}

export function toRecord(r: NormalizedRole, specialty: Specialty, netIndex: Map<string, string>, asOf: string, ref: string): DirectoryRecord {
  const loc = r.location;
  return {
    recordId: `fb:${r.roleId}`,
    npi: r.npi,
    name: displayName(r.name),
    specialty,
    specialtyLabel: specialtyLabel(specialty, r.specialtyCodes, r.specialtyTexts),
    officeId: loc ? `fb:${loc.ref}` : `fb:${r.roleId}:office`,
    officeName: loc?.name ? titleCase(loc.name) : "Office address in directory",
    address: loc ? { line: titleCase(loc.line), city: titleCase(loc.city), state: loc.state, zip: loc.zip } : { line: "", city: "", state: "", zip: "" },
    distanceMi: null, // the directory's Location has no position
    networks: r.networks.map((n) => netIndex.get(n) ?? n),
    newPatients: r.accepting,
    source: { directory: FB_LABEL, mode: "live", asOf, ref },
  };
}

/** Plan A lookup. Never throws: a failed directory comes back as ok:false (N8). */
export async function lookupFloridaBlue(q: FbLookup, opts: FbOptions = {}): Promise<DirectoryAnswer> {
  const t0 = performance.now();
  const asOf = new Date().toISOString();
  const counters = opts.counters ?? new Counters();
  const client = new FhirClient(FB.base, { timeoutMs: opts.timeoutMs ?? 6000, fetchImpl: opts.fetchImpl, counters, maxPages: opts.maxPages ?? 15 });
  let ref = client.url("PractitionerRole", { "location.address-postalcode": q.zip, identifier: `${FLORIDA_BLUE_PLAN_ID_SYSTEM}|${q.planCode}` });
  try {
    const netIndex = await networkIndex(client);
    const got = await fbRoles(q, client, { ...opts, counters });
    ref = got.ref || ref;
    const records = got.roles.map((r) => toRecord(r, q.specialty, netIndex, asOf, got.ref)).sort((a, b) => a.name.localeCompare(b.name) || a.recordId.localeCompare(b.recordId));
    const inNet = new Set(records.filter((r) => r.networks.some((n) => q.networkIds.includes(n))).map((r) => r.npi ?? r.recordId));
    return { ok: true, records, mode: "live", directory: FB_LABEL, ms: Math.round(performance.now() - t0), asOf, ref, inNetworkCount: inNet.size };
  } catch (err) {
    const msg = err instanceof FhirError ? `${err.kind}${err.status ? ` ${err.status}` : ""}: ${err.message}` : (err as Error)?.message ?? String(err);
    return { ok: false, error: msg, mode: "live", directory: FB_LABEL, ms: Math.round(performance.now() - t0), asOf, ref };
  }
}

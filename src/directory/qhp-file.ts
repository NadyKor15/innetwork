// Plan B adapter: marketplace (QHP) machine-readable providers file (CMS format). There is no API for marketplace
// plans (CMS-9115-F did not require one), so "in this plan's network" means "the provider object lists the plan's
// HIOS id in `plans`". Files are 0.5-1.5 GB; we stream them with a byte ceiling and never hold one in memory.
import { Counters, type FetchLike } from "../../packages/plannet-directory-check/src/http.ts";
import { planIdsOf, providerName, streamProviders, zipOf, type QhpProvider } from "../../packages/plannet-directory-check/src/qhp.ts";
import type { DirectoryAnswer, DirectoryRecord, NewPatients, Specialty } from "../core/types.ts";
import { isSpecialty, specialtyLabel } from "./specialties.ts";

export const QHP_LABEL = "Oscar Health machine-readable provider file (CMS QHP JSON)";

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

export function qhpAccepting(a: string | undefined): NewPatients {
  if (a === "accepting") return "accepting";
  if (a === "not accepting") return "not_accepting";
  return "unknown"; // includes "accepting in some locations": not a yes for the office on the card
}

/** Stable id for a provider object without exposing its NPI in the id. */
function hashId(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** One record per provider address inside the ZIP set (the office is the address). */
export function qhpToRecords(p: QhpProvider, specialty: Specialty, zips: string[] | null, source: { asOf: string; ref: string; mode: "file" | "fixture" }): DirectoryRecord[] {
  const name = providerName(p);
  const npi = p.npi === undefined || p.npi === null ? null : String(p.npi);
  const addrs = (p.addresses ?? []).filter((a) => !zips || zips.includes(zipOf(a)));
  return addrs.map((a, i) => ({
    recordId: `qhp:${hashId(`${npi ?? name}|${a.address}|${zipOf(a)}`)}${addrs.length > 1 ? `-${i}` : ""}`,
    npi,
    name: p.type === "INDIVIDUAL" ? `Dr. ${titleCase(name)}` : titleCase(name),
    specialty,
    specialtyLabel: specialtyLabel(specialty, [], p.specialty ?? []),
    officeId: `qhp:office:${hashId(`${a.address}|${a.address_2 ?? ""}|${zipOf(a)}`)}`,
    officeName: a.address_2 ? `${titleCase(a.address ?? "")}, ${titleCase(a.address_2)}` : titleCase(a.address ?? ""),
    address: { line: titleCase(a.address ?? ""), city: titleCase(a.city ?? ""), state: a.state ?? "", zip: zipOf(a) },
    distanceMi: null,
    networks: planIdsOf(p),
    newPatients: qhpAccepting(p.accepting),
    source: { directory: QHP_LABEL, mode: source.mode, asOf: source.asOf, ref: source.ref },
  }));
}

export type QhpOptions = { fetchImpl?: FetchLike; counters?: Counters; maxBytesPerFile?: number; timeoutMs?: number };

/**
 * Plan B lookup straight from the issuer's files (minutes, not seconds: used by `directory:warm`, never inline in a
 * voice turn). Never throws: failure -> ok:false.
 */
export async function lookupQhpFile(q: { specialty: Specialty; zips: string[]; hiosPlanId: string; files: string[] }, opts: QhpOptions = {}): Promise<DirectoryAnswer> {
  const t0 = performance.now();
  const asOf = new Date().toISOString();
  const counters = opts.counters ?? new Counters();
  const records: DirectoryRecord[] = [];
  const failures: string[] = [];
  let bytes = 0;
  for (const url of q.files) {
    try {
      const st = await streamProviders(url, (p) => {
        if (!planIdsOf(p).includes(q.hiosPlanId)) return;
        if (!isSpecialty(q.specialty, [], p.specialty ?? [])) return;
        records.push(...qhpToRecords(p, q.specialty, q.zips, { asOf, ref: url, mode: "file" }));
      }, { fetchImpl: opts.fetchImpl, counters, maxBytes: opts.maxBytesPerFile ?? 2_000_000_000, timeoutMs: opts.timeoutMs ?? 900_000 });
      bytes += st.bytes;
      if (st.stoppedBy === "error") failures.push(`${url}: ${st.error}`);
    } catch (err) {
      failures.push(`${url}: ${(err as Error).message}`);
    }
  }
  const ms = Math.round(performance.now() - t0);
  const ref = `${q.files.join(" + ")} (${Math.round(bytes / 1e6)} MB read)`;
  if (failures.length === q.files.length) return { ok: false, error: failures.join("; "), mode: "file", directory: QHP_LABEL, ms, asOf, ref };
  const inNet = new Set(records.map((r) => r.npi ?? r.recordId));
  return { ok: true, records, mode: "file", directory: QHP_LABEL, ms, asOf, ref: failures.length ? `${ref}; failed: ${failures.join("; ")}` : ref, inNetworkCount: inNet.size };
}

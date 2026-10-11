// The directory service the server uses (contract: DirectoryService in src/core/types.ts).
//
//   fixture  offline: recorded samples only (fixtures/directory). Default for judges: no network, no keys.
//   live     real records, directory fields only (N11): Plan A Florida Blue FHIR, Plan C Molina FHIR, Plan B the
//            issuer's QHP file. Answers come from the warm cache (`npm run directory:warm`, data/cache) when fresh,
//            otherwise from a live request with the timeout. Plan B is never streamed inside a voice turn (minutes):
//            without a warm cache it answers ok:false with the reason.
//   auto     cards from the recorded samples; probe() asks the live directory how many in-network practitioners it
//            has for the specialty in the ZIP: Plan A Florida Blue (live, ~0.1-10 s); Plan C Molina (the live answer
//            `directory:warm` fetched, with its own asOf, else live with a deadline); Plan B has no API (null).
//
// Nothing here throws to the caller: a directory that fails or times out comes back as ok:false (N8).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FetchLike } from "../../packages/plannet-directory-check/src/http.ts";
import type { DirectoryAnswer, DirectoryService, NetworkProbe, Plan, Specialty } from "../core/types.ts";
import { FB_LABEL, lookupFloridaBlue } from "./florida-blue.ts";
import { FIXTURE_ZIPS, loadFixture } from "./fixtures.ts";
import { lookupMolina, MOLINA_LABEL } from "./molina.ts";
import { PLAN_SOURCES, PLANS } from "./plans.ts";
import { lookupQhpFile, QHP_LABEL } from "./qhp-file.ts";

export type DirectoryMode = "fixture" | "live" | "auto";
export type DirectoryOptions = {
  mode?: DirectoryMode;
  /** Timeout of ONE live request (default 6000 ms). */
  timeoutMs?: number;
  /** Warm cache directory (default data/cache). */
  cacheDir?: string;
  /** Max age of a warm-cache answer used by live lookups (default 12 h). */
  cacheMaxAgeMs?: number;
  /** Plan C probe deadline: Molina answers one location per request (default 20 s). */
  molinaDeadlineMs?: number;
  /** Tests: fetch double. */
  fetchImpl?: FetchLike;
  /** Tests: fixture directory. */
  fixtureDir?: string;
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_CACHE_DIR = join(ROOT, "data", "cache");

const directoryLabel = (plan: Plan) => {
  const src = PLAN_SOURCES[plan.planId];
  if (!src) return "unknown directory";
  return src.kind === "qhp-file" ? QHP_LABEL : src.directory === "florida-blue" ? FB_LABEL : MOLINA_LABEL;
};

export function cacheFile(cacheDir: string, planId: string, specialty: Specialty, zip: string): string {
  return join(cacheDir, `${planId}.${specialty}.${zip}.json`);
}
export function writeCache(cacheDir: string, planId: string, specialty: Specialty, zip: string, answer: DirectoryAnswer): void {
  mkdirSync(cacheDir, { recursive: true });
  const f = cacheFile(cacheDir, planId, specialty, zip);
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(answer));
  renameSync(tmp, f);
}
export function readCache(cacheDir: string, planId: string, specialty: Specialty, zip: string, maxAgeMs: number): DirectoryAnswer | null {
  const f = cacheFile(cacheDir, planId, specialty, zip);
  if (!existsSync(f)) return null;
  try {
    const a = JSON.parse(readFileSync(f, "utf8")) as DirectoryAnswer;
    if (!a.ok || Date.now() - Date.parse(a.asOf) > maxAgeMs) return null;
    return { ...a, ref: `${a.ref} (warm cache)` };
  } catch {
    return null;
  }
}

/** One live lookup for a plan, by its source. */
export async function liveLookup(plan: Plan, specialty: Specialty, zip: string, o: { timeoutMs: number; fetchImpl?: FetchLike; withNames?: boolean; molinaDeadlineMs?: number; allowFileStream?: boolean }): Promise<DirectoryAnswer> {
  const src = PLAN_SOURCES[plan.planId];
  const asOf = new Date().toISOString();
  if (!src) return { ok: false, error: `no live source for ${plan.planId}`, mode: "live", directory: "unknown directory", ms: 0, asOf, ref: "-" };
  if (src.kind === "fhir-plannet" && src.directory === "florida-blue") {
    return lookupFloridaBlue({ specialty, zip, planCode: src.planCode, networkIds: plan.networkIds }, { timeoutMs: o.timeoutMs, fetchImpl: o.fetchImpl, withNames: o.withNames });
  }
  if (src.kind === "fhir-plannet" && src.directory === "molina") {
    return lookupMolina({ specialty, zip, network: src.network, networkIds: plan.networkIds }, { timeoutMs: o.timeoutMs, fetchImpl: o.fetchImpl, deadlineMs: o.molinaDeadlineMs });
  }
  if (src.kind === "qhp-file") {
    if (!o.allowFileStream) return { ok: false, error: "plan file not warmed (run `npm run directory:warm`); streaming the issuer's files takes minutes", mode: "file", directory: QHP_LABEL, ms: 0, asOf, ref: src.indexUrl };
    return lookupQhpFile({ specialty, zips: [zip], hiosPlanId: src.hiosPlanId, files: src.providerFiles }, { fetchImpl: o.fetchImpl });
  }
  return { ok: false, error: `unsupported source for ${plan.planId}`, mode: "live", directory: directoryLabel(plan), ms: 0, asOf, ref: "-" };
}

export function createDirectory(opts: DirectoryOptions = {}): DirectoryService {
  const envMode = process.env.DIRECTORY_MODE as DirectoryMode | undefined;
  const mode: DirectoryMode = opts.mode ?? (envMode === "live" || envMode === "auto" || envMode === "fixture" ? envMode : "fixture");
  const timeoutMs = opts.timeoutMs ?? Number(process.env.DIRECTORY_TIMEOUT_MS ?? 6000);
  const cacheDir = opts.cacheDir ?? process.env.DIRECTORY_CACHE_DIR ?? DEFAULT_CACHE_DIR;
  const cacheMaxAgeMs = opts.cacheMaxAgeMs ?? 12 * 3600_000;
  const molinaDeadlineMs = opts.molinaDeadlineMs ?? 20_000;

  async function fixtureLookup(plan: Plan, specialty: Specialty, zip: string): Promise<DirectoryAnswer> {
    const t0 = performance.now();
    const fx = loadFixture(plan.planId, specialty, opts.fixtureDir);
    const ms = Math.round(performance.now() - t0);
    if (!fx || !FIXTURE_ZIPS.includes(zip)) {
      return { ok: true, records: [], mode: "fixture", directory: fx?.directory ?? directoryLabel(plan), ms, asOf: fx?.meta.capturedAt ?? new Date(0).toISOString(), ref: `no recorded sample for ${plan.planId} · ${specialty} · ZIP ${zip}`, inNetworkCount: null };
    }
    return { ok: true, records: fx.records, mode: "fixture", directory: fx.directory, ms, asOf: fx.meta.capturedAt, ref: fx.records[0]?.source.ref ?? fx.file, inNetworkCount: null };
  }

  return {
    mode,
    plans: PLANS,
    async lookup(plan, specialty, zip) {
      if (mode !== "live") return fixtureLookup(plan, specialty, zip);
      const cached = readCache(cacheDir, plan.planId, specialty, zip, cacheMaxAgeMs);
      if (cached) return cached;
      const a = await liveLookup(plan, specialty, zip, { timeoutMs, fetchImpl: opts.fetchImpl, molinaDeadlineMs: 120_000 });
      if (a.ok) try { writeCache(cacheDir, plan.planId, specialty, zip, a); } catch { /* cache is an optimization */ }
      return a;
    },
    async probe(plan, specialty, zip): Promise<NetworkProbe | null> {
      if (mode === "fixture") return null;
      const src = PLAN_SOURCES[plan.planId];
      if (!src || src.kind === "qhp-file") return null; // marketplace plans publish files, not an API (no live probe)
      const asOf = new Date().toISOString();
      if (src.directory === "molina") {
        // Molina answers one location per request and has a daily call quota: a ZIP costs ~40-200 requests. The probe
        // uses the live answer `directory:warm` fetched (fresh within cacheMaxAgeMs, its own asOf), else asks live
        // with a deadline; a partial sweep is reported as not answered, never as a count.
        const cached = readCache(cacheDir, plan.planId, specialty, zip, cacheMaxAgeMs);
        if (cached && cached.ok) return { ok: true, mode: "live", directory: cached.directory, ms: cached.ms, asOf: cached.asOf, ref: cached.ref, inNetworkCount: cached.inNetworkCount ?? cached.records.length };
      }
      try {
        const a = await liveLookup(plan, specialty, zip, { timeoutMs, fetchImpl: opts.fetchImpl, withNames: false, molinaDeadlineMs });
        if (!a.ok) return { ok: false, mode: "live", directory: a.directory, ms: a.ms, asOf: a.asOf, ref: a.ref, error: a.error };
        return { ok: true, mode: "live", directory: a.directory, ms: a.ms, asOf: a.asOf, ref: a.ref, inNetworkCount: a.inNetworkCount ?? a.records.length };
      } catch (err) {
        return { ok: false, mode: "live", directory: directoryLabel(plan), ms: 0, asOf, ref: "-", error: (err as Error)?.message ?? String(err) };
      }
    },
  };
}

export { PLANS } from "./plans.ts";

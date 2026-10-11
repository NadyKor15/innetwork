// Per-household state: one JSON file per user, atomic rename, survives a new MCP session and a server restart.
// What we hold is deliberately small (N4): relative labels, plan ids, the routine as label + time, the parent's own
// notes about doctors, booked visits. Never: names of family members, ages, dates of birth, plan program types,
// member IDs. verify scans every user file for those keys.
//
// Office age policies live in a SEPARATE shared file (office-policies.json): a property of the office, with no
// family data. Notes never go there (N13).
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pronoun } from "../src/core/network-gate.ts";
import type { Role } from "../src/core/schedule.ts";
import type { CheckupItem, OfficePolicy, RoutineBlock } from "../src/core/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = () => process.env.INNETWORK_DATA_DIR ?? join(ROOT, "data");
const usersDir = () => join(dataDir(), "users");
export const policiesFile = () => join(dataDir(), "office-policies.json");

export type Member = { memberId: string; label: string; role: Role; pronoun: Pronoun; planId: string };
export type Visit = {
  visitId: string; memberId: string; item: CheckupItem; recordId: string; doctorName: string; specialtyLabel: string;
  officeId: string; officeName: string; distanceMi: number | null; start: number; end: number;
  status: "booked" | "cancelled"; bookedAt: number; cancelledAt: number | null;
  /** Routine block the parent agreed to book over (N12), if any. */
  overRoutine: string | null;
  /** Booked although out of network after a second explicit yes (N2). */
  outOfNetworkConfirmed: boolean;
  sandboxConfirmation: string;
};
export type Proposal = {
  memberId: string; item: CheckupItem; recordId: string; doctorName: string; specialtyLabel: string;
  officeId: string; officeName: string; distanceMi: number | null; start: number; end: number;
  networkStatus: "in_network" | "out_of_network" | "unknown"; overRoutine: string | null;
};
export type Pending =
  | { kind: "book"; from: "find_in_network" | "checkup_year"; proposals: Proposal[]; at: number }
  | { kind: "cancel"; visitIds: string[]; at: number }
  | null;
export type OutboxItem = { at: number; channel: "alexa_app" | "email"; subject: string; lines: string[]; mode: "sandbox" };
export type Note = { recordId: string; doctorName: string; text: string; at: number };

export type UserState = {
  version: 1;
  userId: string;
  createdAt: number;
  consent: { granted: boolean; at: number; purpose: string } | null;
  profile: { zip: string; timeZone: string };
  family: Member[];
  routine: RoutineBlock[];
  notes: Note[];
  checkup: { memberId: string; oopMetToldAt: number | null; planYearEnd: string; haveOrder: boolean; /** index in visits[] where the checkup batch starts: visits before it were "booked earlier" (the sandbox clock does not move) */ batchFrom: number | null } | null;
  visits: Visit[];
  pending: Pending;
  outbox: OutboxItem[];
  /** Set when the household was created from the demo scenario (developer view shows it as SANDBOX). */
  seededFrom: string | null;
};

const USER_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const fileOf = (userId: string) => {
  if (!USER_ID.test(userId)) throw new Error("invalid user id");
  return join(usersDir(), `${userId}.json`);
};

export function emptyUser(userId: string, now: number): UserState {
  return {
    version: 1, userId, createdAt: now, consent: null,
    profile: { zip: process.env.DEMO_ZIP ?? "32801", timeZone: "America/New_York" },
    family: [], routine: [], notes: [], checkup: null, visits: [], pending: null, outbox: [], seededFrom: null,
  };
}

export function userExists(userId: string): boolean { return existsSync(fileOf(userId)); }

export function loadUser(userId: string, seed: (id: string) => UserState): UserState {
  const f = fileOf(userId);
  if (!existsSync(f)) return seed(userId);
  const s = JSON.parse(readFileSync(f, "utf8")) as UserState;
  if (s?.version !== 1 || s.userId !== userId || !Array.isArray(s.visits)) throw new Error(`corrupt state file for ${userId}`);
  return s;
}

function atomicWrite(f: string, data: unknown): void {
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, f);
}

export function saveUser(s: UserState): void { atomicWrite(fileOf(s.userId), s); }

/** Synchronous read-modify-write. Do all network I/O BEFORE calling this. */
export function updateUser<T>(userId: string, seed: (id: string) => UserState, fn: (s: UserState) => T): T {
  const s = loadUser(userId, seed);
  const out = fn(s);
  saveUser(s);
  return out;
}

export function listUserIds(): string[] {
  if (!existsSync(usersDir())) return [];
  return readdirSync(usersDir()).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((id) => USER_ID.test(id));
}

// ---------- office policies (shared, no family data) ----------
export function loadPolicies(seedFile: string | null): OfficePolicy[] {
  const f = policiesFile();
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")) as OfficePolicy[];
  if (seedFile && existsSync(seedFile)) {
    const seeded = JSON.parse(readFileSync(seedFile, "utf8")) as OfficePolicy[];
    atomicWrite(f, seeded);
    return seeded;
  }
  return [];
}

const POLICY_KEYS = ["officeId", "minAgeMonths", "maxAgeMonths", "source", "learnedAt", "demo"] as const;
/** Adds or replaces one office's policy. Only the six policy fields are kept: nothing else can ride along. */
export function savePolicy(p: OfficePolicy, seedFile: string | null): OfficePolicy[] {
  const clean = Object.fromEntries(POLICY_KEYS.map((k) => [k, p[k]])) as OfficePolicy;
  const all = loadPolicies(seedFile).filter((x) => x.officeId !== clean.officeId);
  all.push(clean);
  all.sort((a, b) => a.officeId.localeCompare(b.officeId));
  atomicWrite(policiesFile(), all);
  return all;
}

/** Keys that must never appear anywhere in a user file (N4). verify scans data/users/*.json with this. */
export const FORBIDDEN_USER_KEYS = /^(age|ages|age_?band|ageBand|age_?months|dob|date_?of_?birth|birth_?date|birthday|name|first_?name|last_?name|full_?name|child_?name|program_?type|programType|member_?id_?number|subscriber_?id|policy_?number)$/i;
export function forbiddenKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => forbiddenKeys(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [...(FORBIDDEN_USER_KEYS.test(k) ? [`${path}.${k}`] : []), ...forbiddenKeys(v, `${path}.${k}`)]);
  }
  return [];
}

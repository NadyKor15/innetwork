// Demo scenario: the fictional household the parent "set up earlier", the sandbox clock and the sandbox booking
// partner's offered slots. Loaded from fixtures/demo/scenario.json.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { slotAt } from "../src/core/schedule.ts";
import type { Slot } from "../src/core/types.ts";
import { emptyUser, type Member, type UserState } from "./store.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SCENARIO_FILE = join(ROOT, "fixtures", "demo", "scenario.json");
export const POLICIES_SEED = join(ROOT, "fixtures", "office-policies.json");

type Raw = {
  now: string; timeZone: string; zip: string; planYearEnd: string; visitMinutes: number;
  family: Member[]; routine: UserState["routine"]; notes: { doctorName: string; text: string }[];
  slots: Record<string, [string, string][]>;
  officeAnswersAtBooking: Record<string, { minAgeMonths: number | null; maxAgeMonths: number | null } | string>;
};

export type Scenario = {
  now: number; tz: string; zip: string; planYearEnd: string; planYearEndMs: number; visitMinutes: number;
  family: Member[]; routine: UserState["routine"]; notes: { doctorName: string; text: string }[];
  /** Sandbox partner slots by doctor display name (fictional doctors only). */
  slotsFor(doctorName: string): Slot[];
  officeAnswer(doctorName: string): { minAgeMonths: number | null; maxAgeMonths: number | null } | null;
};

export function loadScenario(file = SCENARIO_FILE): Scenario {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Raw;
  const tz = raw.timeZone;
  const now = process.env.SIM_NOW ? Date.parse(process.env.SIM_NOW) : Date.parse(raw.now);
  const slotCache = new Map<string, Slot[]>();
  return {
    now, tz, zip: raw.zip, planYearEnd: raw.planYearEnd, visitMinutes: raw.visitMinutes,
    planYearEndMs: slotAt(raw.planYearEnd, "23:59", 1, tz).end,
    family: raw.family, routine: raw.routine, notes: raw.notes,
    slotsFor(name) {
      if (!slotCache.has(name)) slotCache.set(name, (raw.slots[name] ?? []).map(([d, t]) => slotAt(d, t, raw.visitMinutes, tz)));
      return slotCache.get(name)!;
    },
    officeAnswer(name) {
      const a = raw.officeAnswersAtBooking[name];
      return a && typeof a === "object" ? a : null;
    },
  };
}

/** A new demo household: the profile the parent set up earlier (plans, routine, one note). Consent not yet given. */
export function seedHousehold(sc: Scenario, userId: string, recordIdOf: (doctorName: string) => string | null): UserState {
  const u = emptyUser(userId, sc.now);
  u.profile = { zip: sc.zip, timeZone: sc.tz };
  u.family = sc.family.map((m) => ({ ...m }));
  u.routine = sc.routine.map((b) => ({ ...b, days: [...b.days] }));
  u.notes = sc.notes.map((n) => ({ recordId: recordIdOf(n.doctorName) ?? `name:${n.doctorName}`, doctorName: n.doctorName, text: n.text, at: sc.now }));
  u.checkup = { memberId: sc.family.find((m) => m.role === "adult")?.memberId ?? sc.family[0].memberId, oopMetToldAt: null, planYearEnd: sc.planYearEnd, haveOrder: false, batchFrom: null };
  u.seededFrom = "fixtures/demo/scenario.json";
  return u;
}

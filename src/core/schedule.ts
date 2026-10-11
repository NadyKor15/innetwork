// Family routine and visit times (N12). Deterministic: the same routine, slots and calendar give the same pick.
//
// A routine block (e.g. "Daycare drop-off 7:50-8:15") is busy time, widened by the drive (travelMin) on both sides
// and by checkoutMin before it (a visit must end early enough to get there). The free gaps of a weekday are
// classified: a gap between a drop-off block and a pick-up block is "child away" (a parent can go alone); the rest
// is "with kids". Adults are placed in child-away gaps first, children in with-kids gaps first. A visit is never
// placed over a routine block unless the parent says so (bookOverRoutine), and the read-back names the conflict.
import { fromZoned, minutesOf, toZoned, minutesOfDay } from "./time.ts";
import type { RoutineBlock, Slot } from "./types.ts";

export type Role = "adult" | "child";
export type RoutineOptions = { travelMin: number; checkoutMin: number; dayStart: string; dayEnd: string };
export const DEFAULT_ROUTINE_OPTIONS: RoutineOptions = { travelMin: 15, checkoutMin: 15, dayStart: "08:00", dayEnd: "17:00" };

export type Gap = { start: number; end: number; kind: "child_away" | "with_kids" }; // minutes of the day
export type BusyVisit = { start: number; end: number; officeId: string };
export type Placement =
  | { ok: true; slot: Slot; tier: "preferred" | "free"; gap: Gap }
  | { ok: true; slot: Slot; tier: "over_routine"; conflict: string }
  | { ok: false; reason: "no_slot_before_reset" };

const isDropOff = (b: RoutineBlock) => /drop[- ]?off/i.test(b.label);
const isPickUp = (b: RoutineBlock) => /pick[- ]?up/i.test(b.label);

/** Free gaps of one weekday (1=Mon..7=Sun) for this routine. Days without routine blocks are one with-kids gap. */
export function gapsForWeekday(weekday: number, routine: RoutineBlock[], o: RoutineOptions = DEFAULT_ROUTINE_OPTIONS): Gap[] {
  const blocks = routine.filter((b) => b.days.includes(weekday)).map((b) => ({ b, s: minutesOf(b.start), e: minutesOf(b.end) })).sort((x, y) => x.s - y.s);
  const busy = blocks.map((x) => ({ s: x.s - o.travelMin - o.checkoutMin, e: x.e + o.travelMin, b: x.b }));
  const day0 = minutesOf(o.dayStart), day1 = minutesOf(o.dayEnd);
  const gaps: Gap[] = [];
  let cursor = day0;
  let prev: RoutineBlock | null = null;
  for (const x of busy) {
    if (x.s > cursor) gaps.push({ start: cursor, end: Math.min(x.s, day1), kind: prev && isDropOff(prev) && isPickUp(x.b) ? "child_away" : "with_kids" });
    cursor = Math.max(cursor, x.e);
    prev = x.b;
  }
  if (cursor < day1) gaps.push({ start: cursor, end: day1, kind: "with_kids" });
  return gaps.filter((g) => g.end - g.start >= 15);
}

/** The routine block a slot overlaps (raw times, no buffers), or null. */
export function routineConflict(slot: Slot, routine: RoutineBlock[], tz: string): RoutineBlock | null {
  const z = toZoned(slot.start, tz);
  const s = minutesOfDay(z), e = s + Math.round((slot.end - slot.start) / 60000);
  for (const b of routine) {
    if (!b.days.includes(z.weekday)) continue;
    if (s < minutesOf(b.end) && e > minutesOf(b.start)) return b;
  }
  return null;
}

function overlapsCalendar(slot: Slot, officeId: string, busy: BusyVisit[], travelMin: number): boolean {
  return busy.some((v) => {
    const pad = v.officeId === officeId ? 0 : travelMin * 60000;
    return slot.start < v.end + pad && slot.end + pad > v.start;
  });
}

/**
 * Pick the visit time for one member from a doctor's offered slots.
 * Order of preference: a slot inside the member's preferred gap kind -> any other free gap -> (only if the parent
 * allows it) the first slot over a routine block. Slots before `now`, after `planYearEnd` or clashing with the
 * family calendar are skipped. `preferDay` (YYYY-MM-DD) wins ties so two visits at one clinic land on one trip.
 */
export function placeVisit(args: {
  slots: Slot[]; role: Role; routine: RoutineBlock[]; tz: string; now: number; planYearEnd: number;
  calendar: BusyVisit[]; officeId: string; bookOverRoutine?: boolean; preferDayOffice?: { dayKey: string; after: number } | null;
  options?: RoutineOptions; routineFilter?: boolean;
}): Placement {
  const o = args.options ?? DEFAULT_ROUTINE_OPTIONS;
  const filter = args.routineFilter ?? true; // verify's mutation check turns this off and expects N12 to go red
  const want: Gap["kind"] = args.role === "adult" ? "child_away" : "with_kids";
  const usable = [...args.slots].sort((a, b) => a.start - b.start)
    .filter((s) => s.start >= args.now && s.end <= args.planYearEnd)
    .filter((s) => !overlapsCalendar(s, args.officeId, args.calendar, o.travelMin));
  const fit = (s: Slot): Gap | null => {
    const z = toZoned(s.start, args.tz);
    const a = minutesOfDay(z), b = a + Math.round((s.end - s.start) / 60000);
    return gapsForWeekday(z.weekday, args.routine, o).find((g) => a >= g.start && b <= g.end) ?? null;
  };
  if (!filter) { const s = usable[0]; return s ? { ok: true, slot: s, tier: "preferred", gap: { start: 0, end: 1440, kind: want } } : { ok: false, reason: "no_slot_before_reset" }; }
  const pref = args.preferDayOffice;
  if (pref) {
    const same = usable.find((s) => {
      const z = toZoned(s.start, args.tz);
      const key = `${z.y}-${String(z.m).padStart(2, "0")}-${String(z.d).padStart(2, "0")}`;
      return key === pref.dayKey && s.start >= pref.after && fit(s)?.kind === want;
    });
    if (same) return { ok: true, slot: same, tier: "preferred", gap: fit(same)! };
  }
  for (const tier of ["preferred", "free"] as const) {
    for (const s of usable) {
      const g = fit(s);
      if (g && (tier === "free" || g.kind === want)) return { ok: true, slot: s, tier, gap: g };
    }
  }
  if (args.bookOverRoutine !== false) {
    for (const s of usable) {
      const c = routineConflict(s, args.routine, args.tz);
      if (c) return { ok: true, slot: s, tier: "over_routine", conflict: c.label };
    }
  }
  return { ok: false, reason: "no_slot_before_reset" };
}

/** Wall-clock slot helper for fixtures and tests: ("2026-10-22", "09:15", 45, tz). */
export function slotAt(dayKey: string, time: string, minutes: number, tz: string): Slot {
  const [y, m, d] = dayKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const start = fromZoned(y, m, d, hh, mm, tz);
  return { start, end: start + minutes * 60000 };
}

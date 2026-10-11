// Checkup year: lay out the remaining visits of one adult before the plan year resets (SPEC §2 scene 1).
// Deterministic. Inputs are already-gated candidates (fits only, ranked) and their offered slots.
//   N10 lab work is never booked here: it waits for the primary care visit (or an order the parent says she has)
//   N12 every visit is placed through placeVisit (routine gaps, family calendar)
//   Two visits at one clinic land on one trip when the clinic offers it ("same clinic").
import { placeVisit, type BusyVisit, type Placement } from "./schedule.ts";
import { CHECKUP_ORDER } from "./specialty.ts";
import { dateKey, toZoned } from "./time.ts";
import type { CheckupItem, DirectoryRecord, RoutineBlock, Slot, Specialty } from "./types.ts";

export type Candidate = { record: DirectoryRecord; slots: Slot[] };
export type BookedVisit = { item: CheckupItem; start: number; end: number; officeId: string; recordId: string; memberId: string };

export type CheckupLine =
  | { item: CheckupItem; status: "booked"; visit: BookedVisit }                       // booked earlier
  | { item: Specialty; status: "proposed"; record: DirectoryRecord; placement: Extract<Placement, { ok: true }>; sameClinicWith: Specialty | null }
  | { item: "lab_work"; status: "may_need_order"; after: "primary_care" }
  | { item: "lab_work"; status: "ready" }                                              // primary care done or order in hand
  | { item: Specialty; status: "no_fit" | "no_slot" };

export function labWorkStatus(args: { now: number; memberId: string; booked: BookedVisit[]; haveOrder: boolean }): "may_need_order" | "ready" {
  if (args.haveOrder) return "ready";
  const pcpDone = args.booked.some((v) => v.memberId === args.memberId && v.item === "primary_care" && v.end <= args.now);
  return pcpDone ? "ready" : "may_need_order";
}

export function planCheckup(args: {
  items: CheckupItem[]; memberId: string; candidates: Map<Specialty, Candidate[]>; booked: BookedVisit[];
  routine: RoutineBlock[]; tz: string; now: number; planYearEnd: number; haveOrder?: boolean; routineFilter?: boolean;
}): CheckupLine[] {
  const order = [...new Set(args.items)].sort((a, b) => CHECKUP_ORDER.indexOf(a) - CHECKUP_ORDER.indexOf(b));
  const calendar: BusyVisit[] = args.booked.map((v) => ({ start: v.start, end: v.end, officeId: v.officeId }));
  const lines: CheckupLine[] = [];
  const placed: { item: Specialty; officeId: string; dayKey: string; end: number }[] = [];
  for (const item of order) {
    const already = args.booked.find((v) => v.memberId === args.memberId && v.item === item && v.end > args.now);
    if (already) { lines.push({ item, status: "booked", visit: already }); continue; }
    if (item === "lab_work") {
      const st = labWorkStatus({ now: args.now, memberId: args.memberId, booked: args.booked, haveOrder: !!args.haveOrder });
      lines.push(st === "ready" ? { item, status: "ready" } : { item, status: "may_need_order", after: "primary_care" });
      continue;
    }
    const cands = args.candidates.get(item) ?? [];
    if (!cands.length) { lines.push({ item, status: "no_fit" }); continue; }
    let chosen: { c: Candidate; p: Extract<Placement, { ok: true }>; same: Specialty | null } | null = null;
    for (const c of cands) {
      const mate = placed.find((x) => x.officeId === c.record.officeId);
      const p = placeVisit({
        slots: c.slots, role: "adult", routine: args.routine, tz: args.tz, now: args.now, planYearEnd: args.planYearEnd,
        calendar, officeId: c.record.officeId, preferDayOffice: mate ? { dayKey: mate.dayKey, after: mate.end } : null,
        routineFilter: args.routineFilter,
      });
      if (p.ok) {
        const same = mate && dateKey(toZoned(p.slot.start, args.tz)) === mate.dayKey ? mate.item : null;
        chosen = { c, p, same };
        break;
      }
    }
    if (!chosen) { lines.push({ item, status: "no_slot" }); continue; }
    const { c, p, same } = chosen;
    calendar.push({ start: p.slot.start, end: p.slot.end, officeId: c.record.officeId });
    placed.push({ item, officeId: c.record.officeId, dayKey: dateKey(toZoned(p.slot.start, args.tz)), end: p.slot.end });
    lines.push({ item, status: "proposed", record: c.record, placement: p, sameClinicWith: same });
    if (same) {
      const mateLine = lines.find((l) => l.status === "proposed" && l.item === same) as Extract<CheckupLine, { status: "proposed" }> | undefined;
      if (mateLine && !mateLine.sameClinicWith) mateLine.sameClinicWith = item;
    }
  }
  return lines;
}

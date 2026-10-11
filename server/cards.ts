// Card models: what each MCP Apps view renders (structuredContent.card). Customer-facing only: no tool names, no
// JSON, no source badges, no plan types, no stars (SPEC §8). The developer view reads _meta.steps instead.
import { itemField, SPECIALTY_WORDS } from "../src/core/specialty.ts";
import { clock12, dateKey, dayShort, minutesOf, minutesOfDay, timeAmPm, toZoned, fromZoned } from "../src/core/time.ts";
import type { CheckupItem, RoutineBlock } from "../src/core/types.ts";
import type { Member, Visit } from "./store.ts";

export type ViewName = "family-match" | "set-aside" | "visit-plan" | "booked" | "checkup-year" | "consent";
export type MemberColor = "mom" | "older" | "youngest";

export function colorOf(m: Member, family: Member[]): MemberColor {
  if (m.role === "adult") return "mom";
  if (/youngest/i.test(m.label)) return "youngest";
  if (/older|oldest/i.test(m.label)) return "older";
  const kids = family.filter((x) => x.role === "child");
  return kids.indexOf(m) === 0 && kids.length > 1 ? "older" : "youngest";
}

// ---------- week strip (screens 02, 03, 04) ----------
export type WeekVisit = { dayKey: string; start: string; end: string; timeLabel: string; label: string; member: MemberColor; memberLabel: string; state: "proposed" | "booked" | "booked_earlier" | "other_member" };
export type WeekModel = {
  days: { key: string; label: string; weekday: string; date: string }[];
  hours: { start: string; end: string };
  routine: { label: string; start: string; end: string; days: number[]; timeLabel: string }[];
  window: { start: string; end: string; label: string } | null;
  visits: WeekVisit[];
};

export function weekModel(args: { weekStart: number; tz: string; routine: RoutineBlock[]; window: { startMin: number; endMin: number; whoPronoun: string; routineWord: string } | null; visits: WeekVisit[] }): WeekModel {
  const z0 = toZoned(args.weekStart, args.tz);
  const days = [0, 1, 2, 3, 4].map((i) => {
    const t = fromZoned(z0.y, z0.m, z0.d + i, 12, 0, args.tz);
    const z = toZoned(t, args.tz);
    const [wd, mon, d] = dayShort(z).split(" ");
    return { key: dateKey(z), label: dayShort(z), weekday: wd, date: `${mon} ${d}` };
  });
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const routine = args.routine.map((b) => ({ label: b.label, start: b.start, end: b.end, days: b.days, timeLabel: `${clock12(minutesOf(b.start))}–${clock12(minutesOf(b.end))}` }));
  const window = args.window ? { start: hhmm(args.window.startMin), end: hhmm(args.window.endMin), label: `${clock12(args.window.startMin)}–${clock12(args.window.endMin)} · while ${args.window.whoPronoun} at ${args.window.routineWord}` } : null;
  return { days, hours: { start: "07:30", end: "15:00" }, routine, window, visits: args.visits };
}

export function weekVisitOf(v: { start: number; end: number; item: CheckupItem }, tz: string, member: Member, family: Member[], state: WeekVisit["state"]): WeekVisit {
  const zs = toZoned(v.start, tz), ze = toZoned(v.end, tz);
  const hh = (z: ReturnType<typeof toZoned>) => `${String(z.hh).padStart(2, "0")}:${String(z.mm).padStart(2, "0")}`;
  const field = itemField(v.item);
  const color = colorOf(member, family);
  return { dayKey: dateKey(zs), start: hh(zs), end: hh(ze), timeLabel: timeAmPm(zs), label: color === "mom" ? field : `${member.label} · ${field}`, member: color, memberLabel: member.label, state };
}

/** Monday of the week that holds `t` (household time zone). */
export function mondayOf(t: number, tz: string): number {
  const z = toZoned(t, tz);
  return fromZoned(z.y, z.m, z.d - (z.weekday - 1), 0, 0, tz);
}

export const whenLabel = (t: number, tz: string) => { const z = toZoned(t, tz); return `${dayShort(z)} · ${timeAmPm(z)}`; }; // "Thu Oct 22 · 9:15 AM"

// ---------- 01 family match ----------
export type FamilyRow = {
  member: MemberColor; memberLabel: string; ageLabel: string | null; planLabel: string; specialty: string;
  setAside: { name: string; reason: string }[];
  fit: { name: string; detail: string; note: string | null; when: string; booked: boolean; bookedLabel: string | null } | null;
  askOffice: { name: string; reason: string }[];
  none: string | null;
};
export type FamilyMatchCard = { view: "family-match"; title: string; rows: FamilyRow[]; footnote: string | null; prompt: string | null; booked: boolean };

// ---------- 05 set aside ----------
export type SetAsideCard = {
  view: "set-aside";
  heading: { member: MemberColor; specialty: string; forWhom: string; plan: string };
  fitsTitle: string;
  fits: { name: string; specialtyLabel: string; checks: string[]; when: string | null; booked: boolean; bookedLabel: string | null }[];
  setAsideTitle: string;
  setAside: { name: string; reason: string; kind: "age" | "network" | "new_patients" | "ask_office" | "not_confirmed" }[];
  footer: string | null;
};

// ---------- 03 visit plan ----------
export type VisitPlanCard = {
  view: "visit-plan"; quote: string | null; title: string; week: WeekModel;
  doctors: { specialty: string; name: string; when: string; detail: string; tag: string | null; quiet: boolean }[];
  sourceLine: string | null;
  lab: string | null;
  prompt: string | null;
};

// ---------- 04 booked ----------
export type BookedCard = {
  view: "booked"; title: string; subtitle: string | null;
  list: { when: string; label: string; earlier: boolean; note: string | null; member: MemberColor }[];
  week: WeekModel | null;
  notices: { icon: "doc" | "mic"; text: string }[];
};

// ---------- 02 checkup year ----------
export type CheckupYearCard = {
  view: "checkup-year"; title: string; subtitle: string; source: string;
  items: { memberLabel: string; member: MemberColor; item: string; status: "booked" | "booked_earlier" | "may_need_order" | "open"; text: string; detail: string | null }[];
  week: WeekModel;
};

// ---------- 06 consent ----------
export type ConsentCard = {
  view: "consent"; title: string;
  lines: { icon: "family" | "calendar" | "note" | "lock" | "chat"; text: string }[];
  disclaimer: string;
  actions: { label: string; message: string; style: "primary" | "secondary" }[];
  state: "ask" | "granted" | "declined";
};

export type CardModel = FamilyMatchCard | SetAsideCard | VisitPlanCard | BookedCard | CheckupYearCard | ConsentCard;

export function consentCard(state: ConsentCard["state"]): ConsentCard {
  return {
    view: "consent", title: "Before we start", state,
    lines: [
      { icon: "family", text: "I use your family's plan names and the age you tell me — only to find in-network doctors. I don't save ages." },
      { icon: "calendar", text: "I use your family routine, like daycare drop-off, only to pick visit times." },
      { icon: "note", text: "Notes you tell me about a doctor stay with your family. No ratings." },
      { icon: "lock", text: "I never read member IDs aloud." },
      { icon: "chat", text: "I don't give medical advice or pick a specialty for you." },
    ],
    disclaimer: "This information is not a substitute for professional medical advice. Consult a healthcare provider for personal medical decisions.",
    actions: [{ label: "Allow", message: "Allow.", style: "primary" }, { label: "Not now", message: "Not now.", style: "secondary" }],
  };
}

export const visitLabel = (v: Pick<Visit, "item">) => (v.item === "lab_work" ? "lab work" : SPECIALTY_WORDS[v.item].visit);
export { minutesOfDay };

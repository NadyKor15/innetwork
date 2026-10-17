// Everything Alexa says, as fixed templates filled from data (no model). Every line passes the linter (N5/N7/N9 and
// the 20-second budget) before it leaves the server.
import { assertSpeech, DISCLAIMER } from "../src/core/lint.ts";
import { SPECIALTY_WORDS, itemVisit } from "../src/core/specialty.ts";
import { toZoned, weekdayLong, timeAmPm } from "../src/core/time.ts";
import type { CheckupItem, Specialty } from "../src/core/types.ts";
import type { Pronoun } from "../src/core/network-gate.ts";

const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
export const numberWord = (n: number) => NUM[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const possessive = (p: Pronoun) => (p === "he" ? "his" : p === "she" ? "her" : "their");
const contraction = (p: Pronoun) => (p === "he" ? "he's" : p === "she" ? "she's" : "they're");

export const CONSENT_ASK = assertSpeech(`Before we start, here's what I use and why. ${DISCLAIMER} Say allow to continue.`);
export const CONSENT_GIVEN = assertSpeech("Thanks. You can change this anytime.");
export const CONSENT_DECLINED = assertSpeech("OK. I won't look anything up until you allow it.");
export const CONSENT_REQUIRED = assertSpeech("Before I look anything up, I need your OK. Say allow to continue.");
export const BOOKED_SHORT = assertSpeech("Booked.");
export const BOOKED_WRITTEN = assertSpeech("Booked. Details in your Alexa app and email. Say cancel anytime.");
export const NOTHING_PENDING = assertSpeech("There's nothing waiting for a yes right now.");

/** Opening read-back for several people at once. */
export function familyReadBack(peopleWithFit: number, peopleAsked: number, missing: { label: string; pronoun: Pronoun }[]): string {
  const both = peopleWithFit === 2 ? "both" : `all ${numberWord(peopleWithFit)}`;
  if (peopleWithFit === peopleAsked) return assertSpeech(`One doctor each, in their own plan. Book ${both}?`);
  const miss = missing.map((m) => `nothing yet for ${m.label.toLowerCase()} in ${possessive(m.pronoun)} plan`).join(", ");
  if (peopleWithFit === 0) return assertSpeech(`I couldn't find a doctor in each plan yet: ${miss}.`);
  return assertSpeech(`${cap(miss)}. The others have one doctor each, in their own plan. Book ${peopleWithFit === 1 ? "that one" : both}?`);
}

/** One person, one specialty (scene 2): what was checked and why some were set aside. */
export function searchSummary(args: { checked: number; ageSetAside: { count: number; under: string | null }; network: number; notAccepting: number; fits: number; askOffice: number; pronoun: Pronoun; adult: boolean }): string {
  const parts: string[] = [`I checked ${numberWord(args.checked)} nearby.`];
  const clauses: string[] = [];
  if (args.ageSetAside.count) {
    const who = args.ageSetAside.count === 1 ? "One doesn't" : `${cap(numberWord(args.ageSetAside.count))} don't`;
    clauses.push(args.ageSetAside.under ? `${who} see children under ${numberWord(Number(args.ageSetAside.under)) ?? args.ageSetAside.under}` : `${who} see children that age`);
  }
  if (args.network) clauses.push(`${args.network === 1 ? "one isn't" : `${numberWord(args.network)} aren't`} in ${args.adult ? "your" : possessive(args.pronoun)} plan`);
  if (args.notAccepting) clauses.push(`${args.notAccepting === 1 ? "one isn't" : `${numberWord(args.notAccepting)} aren't`} taking new patients`);
  if (clauses.length) parts.push(`${cap(clauses.join(", "))}.`);
  if (args.fits) parts.push(args.fits === 1 ? "This one fits." : args.fits === 2 ? "These two fit." : `These ${numberWord(args.fits)} fit.`);
  else if (args.askOffice) parts.push(args.askOffice === 1 ? "One may fit — I'll ask the office." : "Some may fit — I'll ask the offices.");
  else parts.push("None fit yet.");
  return assertSpeech(parts.join(" "));
}

/** The out-of-pocket line is shown on the visit-plan screen, not spoken: it kept the scene-1 turn over 25 s. Same N9 wording as the checkup-year subtitle. */
export const oopNote = (until: string) => `Out-of-pocket max met · plans usually pay 100% of covered in-network care until ${until} · Source: HealthCare.gov glossary`;

export type PlanSpeechInput = {
  tz: string;
  bookedEarlier: { item: CheckupItem; start: number }[];
  proposals: { item: Specialty; start: number; end: number; officeId: string }[];
  allInWindow: boolean;          // every proposal sits in the child-away gap
  childPronoun: Pronoun | null;
  routineLabel: string | null;   // "daycare"
};

/** Scene 1 read-back: built from the plan, grouped by day, same clinic named. Hours and the lab-work note are on the
 *  screen (window band, lab row), so the voice keeps only days, the routine and the question (about 10 s). */
export function checkupReadBack(p: PlanSpeechInput): string {
  const s: string[] = [];
  for (const b of p.bookedEarlier) {
    if (b.item === "lab_work") continue;
    s.push(`Your ${SPECIALTY_WORDS[b.item].person} is already booked for ${weekdayLong(toZoned(b.start, p.tz))}.`);
  }
  const byDay = new Map<string, typeof p.proposals>();
  for (const x of [...p.proposals].sort((a, b) => a.start - b.start)) {
    const k = weekdayLong(toZoned(x.start, p.tz));
    byDay.set(k, [...(byDay.get(k) ?? []), x]);
  }
  for (const [day, xs] of byDay) {
    const same = xs.length > 1 && xs.every((x) => x.officeId === xs[0].officeId);
    const list = xs.map((x) => itemVisit(x.item));
    s.push(`${day}${same ? ", same clinic" : ""}: ${list.length > 1 ? `${list.slice(0, -1).join(", ")}, then ${list.at(-1)}` : list[0]}.`);
  }
  if (p.proposals.length && p.allInWindow && p.childPronoun && p.routineLabel) s.push(`All while ${contraction(p.childPronoun)} at ${p.routineLabel}.`);
  if (p.proposals.length) s.push(p.proposals.length === 1 ? "Book this one?" : p.proposals.length === 2 ? "Book these two?" : `Book these ${numberWord(p.proposals.length)}?`);
  else s.push("Nothing new to book right now.");
  return assertSpeech(s.join(" "));
}

/** "What's left on my checkup plan?" */
export function checkupStatus(args: { booked: number; labWaits: boolean; labAfterDay: string | null; open: string[] }): string {
  const s: string[] = [`${cap(numberWord(args.booked))} booked.`];
  if (args.labWaits) s.push(args.labAfterDay ? `Lab work comes after ${args.labAfterDay}'s visit.` : "Lab work comes after your primary care visit.");
  if (args.open.length) s.push(`Still to book: ${args.open.join(", ")}.`);
  return assertSpeech(s.join(" "));
}

export function overRoutineAsk(label: string): string { return assertSpeech(`That's during ${label.toLowerCase()}. Book it anyway?`); }
export function outOfNetworkAsk(memberLabel: string, pronoun: Pronoun): string { return assertSpeech(`That doctor is out of network for ${memberLabel === "Mom" ? "you" : `${possessive(pronoun)} plan`}. Book anyway?`); }
export function cancelReadBack(visitLabel: string, start: number, tz: string): string { const z = toZoned(start, tz); return assertSpeech(`Cancel ${visitLabel} on ${weekdayLong(z)} at ${timeAmPm(z)}?`); }
export const CANCELLED = assertSpeech("Cancelled. Details in your Alexa app and email.");
export const LAB_NEEDS_ORDER = assertSpeech("Lab work may need an order from your doctor. I'll add it after your primary care visit.");

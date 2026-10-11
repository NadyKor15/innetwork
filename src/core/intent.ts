// Deterministic utterance -> tool mapping for the simulated host (no model). In the real product Alexa+ supplies
// language understanding; this only has to cover the demo phrases and their obvious variants, and refuse the rest.
import { refusalFor } from "./lint.ts";
import { specialtiesIn } from "./specialty.ts";
import type { CheckupItem, Specialty } from "./types.ts";

export type Intent =
  | { kind: "refuse"; rule: "N1" | "N7"; line: string }
  | { kind: "tool"; name: string; args: Record<string, unknown> }
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "help"; line: string };

const YES = /^(yes|yeah|yep|sure|ok|okay|do it|go ahead|please do|book (it|them|all|both)|confirm)\b/i;
const NO = /^(no|nope|don'?t|do not|never mind|stop|not now)\b/i;
const NUM: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12" };
const n = (w: string) => NUM[w.toLowerCase()] ?? w;

/** Who a specialty is for, from the words right after it ("for my five-year-old", "for my little one", "for me"). */
function whoAndAge(segment: string, tail: string): { member: string; age?: string } {
  const s = segment.toLowerCase();
  const age = s.match(/\b(\w+)[- ]year[- ]old\b/);
  const under = (s + " " + tail.toLowerCase()).match(/\bunder (\w+)\b/);
  if (/\bfor (my )?(youngest|little one|baby|toddler|son|daughter)\b/.test(s) && !age) return { member: "Youngest", ...(under ? { age: `under ${n(under[1])}` } : {}) };
  if (age) return { member: /\b(youngest|little)\b/.test(s) ? "Youngest" : "Older child", age: n(age[1]) };
  if (/\bfor (my )?(older|oldest|big)\b/.test(s)) return { member: "Older child" };
  return { member: "Mom" };
}

export function parseUtterance(raw: string, pending: "book" | "cancel" | "consent" | null): Intent {
  const u = raw.trim().replace(/^alexa[,!.]?\s*/i, "").trim();
  const specs = specialtiesIn(u);
  const r = refusalFor(u, specs.length > 0);
  if (r) return { kind: "refuse", ...r };
  if (/^(allow|i allow|yes,? allow)\b/i.test(u)) return { kind: "tool", name: "consent", args: { action: "allow" } };
  if (pending === "consent" && NO.test(u)) return { kind: "tool", name: "consent", args: { action: "decline" } };
  if (/\bopen in ?network\b|\bbefore we start\b/i.test(u)) return { kind: "tool", name: "consent", args: { action: "show" } };
  if (pending && YES.test(u)) return { kind: "yes" };
  if (pending && NO.test(u)) return { kind: "no" };
  if (/what'?s left|what is left|what'?s next|\bstatus\b/i.test(u) && /checkup|plan|visits?/i.test(u)) return { kind: "tool", name: "checkup_year", args: { action: "status" } };
  if (/\bcancel\b/i.test(u)) {
    const s = specs[0]?.specialty;
    return { kind: "tool", name: "cancel_visit", args: { ...(s ? { specialty: s } : {}), confirm: false } };
  }
  if (/out[- ]of[- ]pocket|\bcheckup\b|before my plan resets/i.test(u)) {
    const items: CheckupItem[] = [...specs.map((x) => x.specialty), ...(/\blab(s| work)?\b|\bblood ?work\b/i.test(u) ? ["lab_work" as const] : [])];
    return { kind: "tool", name: "checkup_year", args: { action: "plan", ...(items.length ? { items } : {}), ...(/out[- ]of[- ]pocket max/i.test(u) && !/\bnot\b/i.test(u) ? { oop_met: true } : {}) } };
  }
  if (specs.length) {
    const requests = specs.map((x, i) => {
      const seg = u.slice(x.at, specs[i + 1]?.at ?? u.length);
      const w = whoAndAge(seg, "");
      return { member: w.member, specialty: x.specialty as Specialty, ...(w.age ? { age_for_this_search: w.age } : {}) };
    });
    return { kind: "tool", name: "find_in_network", args: { requests } };
  }
  return { kind: "help", line: 'Try: "I need a gastroenterologist, an allergist for my five-year-old, and an orthopedist for my little one. He\'s under two." or "What\'s left on my checkup plan?"' };
}

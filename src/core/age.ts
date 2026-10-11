// Age band said by the parent for ONE search (N4). Parsed here, passed as a request parameter, never stored.
// Accepts what the host hears: "under 2", "under two", "5", "five", "five-year-old", "18 months".
import type { AgeBand } from "./types.ts";

const WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
};
const num = (w: string): number | null => (/^\d{1,2}$/.test(w) ? Number(w) : w in WORDS ? WORDS[w] : null);

/** Returns null when the phrase is not an age band we understand (the tool then refuses rather than guess). */
export function parseAgeBand(said: string): AgeBand | null {
  const s = said.toLowerCase().replace(/-/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  let m = s.match(/^(?:under|younger than|less than) (\w+)(?: years?(?: old)?)?$/);
  if (m) {
    const n = num(m[1]);
    if (n === null || n < 1 || n > 18) return null;
    return { label: `under ${n}`, minMonths: 0, maxMonths: n * 12 - 1 };
  }
  m = s.match(/^(\w+) months?(?: old)?$/);
  if (m) {
    const n = num(m[1]);
    if (n === null || n > 35) return null;
    return { label: `${n} months`, minMonths: n, maxMonths: n };
  }
  m = s.match(/^(\w+)(?: years? old| year old| years?)?$/);
  if (m) {
    const n = num(m[1]);
    if (n === null || n > 17) return null;
    return { label: String(n), minMonths: n * 12, maxMonths: n * 12 + 11 };
  }
  return null;
}

/** Spoken/printed form of an office policy limit: 36 months -> "3". */
export const yearsOf = (months: number) => (months % 12 === 0 ? String(months / 12) : `${Math.round((months / 12) * 10) / 10}`);

// Wall-clock helpers for one IANA time zone (the household's). Pure functions; no "now" here.
export type Zoned = { y: number; m: number; d: number; hh: number; mm: number; weekday: number /* 1=Mon..7=Sun */ };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
    fmtCache.set(tz, f);
  }
  return f;
}
const WD: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function toZoned(ms: number, tz: string): Zoned {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, weekday: WD[p.weekday] };
}

/** Epoch ms of a wall-clock time in tz (two-pass offset fix; exact outside the DST gap hour). */
export function fromZoned(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const z1 = toZoned(guess, tz);
  const off1 = Date.UTC(z1.y, z1.m - 1, z1.d, z1.hh, z1.mm) - guess;
  const t = guess - off1;
  const z2 = toZoned(t, tz);
  const off2 = Date.UTC(z2.y, z2.m - 1, z2.d, z2.hh, z2.mm) - t;
  return guess - off2;
}

export const hm = (s: string): [number, number] => {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`bad time ${s}`);
  return [Number(m[1]), Number(m[2])];
};
export const minutesOf = (s: string) => { const [h, m] = hm(s); return h * 60 + m; };
export const minutesOfDay = (z: Zoned) => z.hh * 60 + z.mm;
export const clock12 = (min: number) => {
  const h = Math.floor(min / 60), m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}` : `${h12}:${String(m).padStart(2, "0")}`;
};

const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_LONG = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayShort = (z: Zoned) => `${DAY[z.weekday]} ${MON[z.m]} ${z.d}`;           // "Thu Oct 22"
export const weekdayLong = (z: Zoned) => DAY_LONG[z.weekday];                           // "Thursday"
export const timeAmPm = (z: Zoned) => `${z.hh % 12 === 0 ? 12 : z.hh % 12}:${String(z.mm).padStart(2, "0")} ${z.hh < 12 ? "AM" : "PM"}`; // "9:15 AM"
export const dateKey = (z: Zoned) => `${z.y}-${String(z.m).padStart(2, "0")}-${String(z.d).padStart(2, "0")}`;

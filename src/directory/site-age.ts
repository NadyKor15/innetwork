// What a practice's OWN web page says about the patient ages it sees (SPEC §5.1, second measurement).
// Pure text functions: HTML -> visible text -> age statements. No network here (scripts/audit-sites.ts fetches).

export type SiteAge =
  | { kind: "min_age"; minYears: number; quote: string }
  | { kind: "max_age"; maxYears: number; quote: string }
  | { kind: "range"; minYears: number; maxYears: number; quote: string }
  | { kind: "adults_only"; quote: string }
  | { kind: "children_only"; quote: string }
  | { kind: "all_ages"; quote: string };

/** Visible text of an HTML page: scripts, styles and tags removed, entities decoded, whitespace collapsed. */
export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|td|section|article)>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&ndash;|&mdash;|&#8211;/g, "-").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, newborn: 0, birth: 0, infancy: 0 };
const n = (s: string): number | null => (/^\d{1,2}$/.test(s) ? Number(s) : s.toLowerCase() in NUM ? NUM[s.toLowerCase()] : null);
const W = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen)";
const B = "(birth|newborns?|infancy|0)";

type Rule = { re: RegExp; make: (m: RegExpExecArray) => SiteAge | null };
const quote = (m: RegExpExecArray, text: string) => text.slice(Math.max(0, m.index - 40), Math.min(text.length, m.index + m[0].length + 40)).trim();

/** Ordered rules; the first match per sentence wins. Patterns aim at how practices phrase it on their own pages. */
const RULES = (text: string): Rule[] => [
  // "ages 3 to 18", "ages 2-21", "from birth to 18", "patients 5 through 17"
  { re: new RegExp(`\\b(?:ages?|aged|patients?|children)\\s*(?:seen|treated)?\\s*:?\\s*(?:from\\s+)?(?:${W}|${B})\\s*(?:-|to|through|thru|until)\\s*${W}\\b`, "i"),
    make: (m) => { const lo = m[1] ? n(m[1]) : 0; const hi = n(m[3]); return lo === null || hi === null ? null : { kind: "range", minYears: lo, maxYears: hi, quote: quote(m, text) }; } },
  { re: new RegExp(`\\bfrom\\s+${B}\\s*(?:-|to|through|until)\\s*(?:age\\s*)?${W}\\b`, "i"),
    make: (m) => { const hi = n(m[2]); return hi === null ? null : { kind: "range", minYears: 0, maxYears: hi, quote: quote(m, text) }; } },
  // "ages 3 and up", "patients 18 and older", "children 2 years and older", "age 16+"
  { re: new RegExp(`\\b(?:ages?|aged|patients?|children|kids|adults?)\\s*(?:seen|treated)?\\s*:?\\s*${W}\\s*(?:years?(?:\\s*old)?\\s*)?(?:\\+|and\\s+(?:up|older|over|above)|or\\s+older)`, "i"),
    make: (m) => { const v = n(m[1]); return v === null ? null : { kind: "min_age", minYears: v, quote: quote(m, text) }; } },
  // "no patients under 3", "we do not see children under 2", "must be at least 12", "minimum age 5"
  { re: new RegExp(`\\b(?:not\\s+(?:see|treat|accept)\\w*|no)\\s+(?:patients?|children|kids)\\s+(?:under|younger\\s+than)\\s+(?:the\\s+age\\s+of\\s+)?${W}\\b`, "i"),
    make: (m) => { const v = n(m[1]); return v === null ? null : { kind: "min_age", minYears: v, quote: quote(m, text) }; } },
  { re: new RegExp(`\\b(?:at\\s+least|minimum\\s+age(?:\\s+of|\\s+is)?)\\s+${W}\\s*(?:years?)?`, "i"),
    make: (m) => { const v = n(m[1]); return v === null ? null : { kind: "min_age", minYears: v, quote: quote(m, text) }; } },
  // "patients under 18", "children up to age 17"
  { re: new RegExp(`\\b(?:patients|children|kids)\\s+(?:under|up\\s+to(?:\\s+age)?|younger\\s+than)\\s+${W}\\b`, "i"),
    make: (m) => { const v = n(m[1]); return v === null ? null : { kind: "max_age", maxYears: v, quote: quote(m, text) }; } },
  { re: /\b(?:adults?\s+only|adult\s+patients\s+only|we\s+(?:only\s+)?(?:see|treat)\s+adults)\b/i, make: (m) => ({ kind: "adults_only", quote: quote(m, text) }) },
  { re: /\b(?:pediatric|paediatric|children)\s+(?:patients\s+)?only\b/i, make: (m) => ({ kind: "children_only", quote: quote(m, text) }) },
  { re: /\b(?:patients\s+of\s+all\s+ages|all\s+ages|children\s+and\s+adults|infants?,\s+children(?:,)?\s+and\s+adults)\b/i, make: (m) => ({ kind: "all_ages", quote: quote(m, text) }) },
];

/** Every age statement in a page's visible text (deduplicated by kind + numbers). */
export function siteAgeStatements(htmlOrText: string): SiteAge[] {
  const text = /<[a-z!/]/i.test(htmlOrText) ? visibleText(htmlOrText) : htmlOrText;
  const out: SiteAge[] = [];
  const seen = new Set<string>();
  for (const sentence of text.split(/(?<=[.!?;])\s+/)) {
    for (const rule of RULES(sentence)) {
      const m = rule.re.exec(sentence);
      if (!m) continue;
      const a = rule.make(m);
      if (!a) continue;
      const key = JSON.stringify({ ...a, quote: undefined });
      if (!seen.has(key)) { seen.add(key); out.push(a); }
      break;
    }
  }
  return out;
}

/** The youngest age a page says it sees, when it says one (min_age or range); "children only"/"all ages" -> 0. */
export function minimumAgeStated(statements: SiteAge[]): number | null {
  const mins = statements.flatMap((s) => (s.kind === "min_age" || s.kind === "range" ? [s.minYears] : s.kind === "all_ages" || s.kind === "children_only" ? [0] : s.kind === "adults_only" ? [18] : []));
  return mins.length ? Math.min(...mins) : null;
}

// Checks every line Alexa says before it leaves the server, plus the fixed refusals.
//   N1  no specialty picked for the parent; a symptom without a specialty gets a fixed answer
//   N5  never recite a member ID (or anything shaped like one) by voice
//   N7  no emergency promises; "emergency" gets one fixed line
//   N9  never "free" / "no cost"; a coverage line must say "usually" and name its source
//   Voice budget: one reply <= 20 s at 2.5 words/s (SPEC §2)
export const WORDS_PER_SECOND = 2.5;
export const MAX_REPLY_SECONDS = 20;

export const LINE_N1 = "I can't suggest a kind of doctor. Tell me which doctor you'd like, and I'll find one in your network.";
export const LINE_N7 = "I can't help with emergencies. If this is an emergency, call 911.";
export const DISCLAIMER = "This information is not a substitute for professional medical advice. Consult a healthcare provider for personal medical decisions.";

/** Spoken words: tokens with a letter or digit ("—" is not a word; "8:30" is). */
export const words = (s: string) => s.trim().split(/\s+/).filter((t) => /[A-Za-z0-9]/.test(t)).length;
export const seconds = (s: string) => Math.round((words(s) / WORDS_PER_SECOND) * 10) / 10;

export type LintIssue = { rule: "N5" | "N7" | "N9" | "budget"; text: string };

const MEMBER_ID = /\b[A-Z]{0,4}\d{6,}\b|\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/; // member/subscriber ids, SSN-shaped numbers
const FREE = /\bfree\b|\bno[- ]cost\b|\bat no charge\b|\bcosts? nothing\b/i;
const COVERAGE = /\b(pay|pays|paid|cover|covers|covered)\b.*\b(100%|in full|everything)\b|\bout-of-pocket max\b/i;
const EMERGENCY_PROMISE = /\b(I'll|I will|I can) (get you help|call (911|an ambulance|for help)|send help)\b/i;

export function lintSpeech(text: string): LintIssue[] {
  const out: LintIssue[] = [];
  if (MEMBER_ID.test(text)) out.push({ rule: "N5", text: "looks like an ID number spoken aloud" });
  if (FREE.test(text)) out.push({ rule: "N9", text: 'says "free" or "no cost"' });
  if (COVERAGE.test(text) && !(/\busually\b/i.test(text) && /\bper [A-Z][\w.]+/.test(text))) out.push({ rule: "N9", text: 'coverage line without "usually" and a named source' });
  if (EMERGENCY_PROMISE.test(text)) out.push({ rule: "N7", text: "promises emergency help" });
  if (seconds(text) > MAX_REPLY_SECONDS) out.push({ rule: "budget", text: `${seconds(text)} s > ${MAX_REPLY_SECONDS} s` });
  return out;
}

/** Throws on any issue: the server never sends a line that fails the linter. */
export function assertSpeech(text: string): string {
  const issues = lintSpeech(text);
  if (issues.length) throw new Error(`speech lint: ${issues.map((i) => `${i.rule} ${i.text}`).join("; ")} :: ${text}`);
  return text;
}

const EMERGENCY = /\b(emergenc(y|ies)|911|can't breathe|cannot breathe|not breathing|unconscious|seizure|chest pain|overdose|choking)\b/i;
const SYMPTOM = /\b(rash|fever|cough|itch(y|ing)?|pain|hurts?|ache|aching|bleeding|vomit(ing)?|diarrh(o)?ea|swollen|swelling|dizzy|headache|stomach ?ache|sore throat|lump|tired all the time)\b/i;

/** Fixed answers for requests the add-on refuses. null = not a refusal (the host goes on to tools). */
export function refusalFor(utterance: string, hasSpecialty: boolean): { rule: "N1" | "N7"; line: string } | null {
  if (EMERGENCY.test(utterance)) return { rule: "N7", line: LINE_N7 };
  if (!hasSpecialty && SYMPTOM.test(utterance)) return { rule: "N1", line: LINE_N1 };
  return null;
}

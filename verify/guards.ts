// Static guards over the repository (no servers needed). Each guard prints a must-light control on SYNTHETIC input,
// so "0 found" means "searched and none", not "the search is blind".
//   G5  placeholder strings from the mockups never reach views, host, fixtures or the demo script (SPEC §8)
//   G6  no personal data patterns (emails, phone numbers, SSNs, dates of birth) in the tracked tree
//   G7  owner not decided yet: no brand/author line for a company in code or README (LICENSE says pending)
//   G8  MIT license present
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Row } from "./protocol.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tracked = (): string[] => execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const textFile = (f: string) => /\.(ts|js|json|html|css|md|txt|svg)$/.test(f);

export const PLACEHOLDERS = ["412", "10:42", "0/0", "★", "demo reviews", "checked today", "Maya Lin", "Sam Ruiz"];
export const PLACEHOLDER_SCOPE = (f: string) => /^(views|host|fixtures)\//.test(f) || f === "scripts/demo.ts";
export function placeholderHits(files: { path: string; text: string }[]): string[] {
  return files.flatMap((f) => PLACEHOLDERS.filter((p) => f.text.includes(p)).map((p) => `${f.path}: "${p}"`));
}

const PII = [
  { name: "email", re: /\b[A-Za-z0-9._%+-]+@(?!example\.(com|org)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { name: "us-phone", re: /\b\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/ },
  { name: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: "dob", re: /\b(dob|date of birth|born on)\b\s*[:=]?\s*\d/i },
];
export function piiHits(files: { path: string; text: string }[]): string[] {
  return files.flatMap((f) => PII.flatMap((p) => (p.re.test(f.text) ? [`${f.path}: ${p.name} (${f.text.match(p.re)![0].slice(0, 24)})`] : [])));
}
const BRAND = /retail ?box/i;

export function runStaticGuards(log: (s: string) => void): Row[] {
  const rows: Row[] = [];
  const add = (id: string, check: string, expected: string, actual: string, pass: boolean) => { rows.push({ id, check, expected, actual, pass }); log(`${pass ? "PASS" : "FAIL"} ${id} ${check} :: ${actual}`); };
  const all = tracked().filter(textFile).filter((f) => !f.startsWith("node_modules/"));
  const read = (f: string) => { try { return readFileSync(join(ROOT, f), "utf8"); } catch { return ""; } };

  const scope = all.filter(PLACEHOLDER_SCOPE).map((path) => ({ path, text: read(path) }));
  const hits = placeholderHits(scope);
  const control = placeholderHits([{ path: "synthetic", text: "verify 0/0 PASS · 412 ms · ★★★★ · checked today · Maya Lin" }]).length;
  add("G5", "mockup placeholders never reach views, host, fixtures, demo script (SPEC §8)", `0 hits in scope; control finds 5`, `${hits.length ? hits.slice(0, 3).join(" | ") : "0 hits"} in ${scope.length} files · control ${control}`, hits.length === 0 && control === 5);

  // Personal data scan: everything tracked except third-party font/license text and lockfiles.
  const piiScope = all.filter((f) => !/package-lock\.json$|OFL-LICENSE|^design\/fonts\//.test(f)).map((path) => ({ path, text: read(path) }));
  const pii = piiHits(piiScope).filter((h) => !/verify\/guards\.ts/.test(h));
  const piiControl = piiHits([{ path: "synthetic", text: "mail a.b@gmail.com or call (407) 555-0137, ssn 123-45-6789, DOB: 01/02/2023" }]).length;
  add("G6", "no personal data patterns in the tracked tree (emails, phones, SSN, DOB)", "0 hits; control finds 4", `${pii.length ? pii.slice(0, 3).join(" | ") : "0 hits"} in ${piiScope.length} files · control ${piiControl}`, pii.length === 0 && piiControl === 4);

  const brandScope = all.filter((f) => !/^verify\/guards\.ts$|package-lock\.json$|^design\/fonts\//.test(f)).map((path) => ({ path, text: read(path) }));
  const brand = brandScope.filter((f) => BRAND.test(f.text)).map((f) => f.path);
  add("G7", "owner pending: no company/author branding in the tree", `0 files; control ${BRAND.test("RetailBox") ? "lights" : "BLIND"}`, brand.length ? brand.slice(0, 5).join(", ") : `0 of ${brandScope.length} files`, brand.length === 0 && BRAND.test("RetailBox"));

  const lic = read("LICENSE");
  add("G8", "MIT license at the root", "MIT License + permission notice", lic.split("\n").slice(0, 3).join(" ").trim(), /^MIT License/.test(lic) && /Permission is hereby granted, free of charge/.test(lic));
  return rows;
}

if (import.meta.main) {
  const rows = runStaticGuards(console.log);
  process.exit(rows.every((r) => r.pass) ? 0 : 1);
}

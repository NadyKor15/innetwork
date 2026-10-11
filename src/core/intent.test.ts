import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUtterance } from "./intent.ts";
import { LINE_N1, LINE_N7 } from "./lint.ts";

test("opening phrase -> three requests with the ages the mom said", () => {
  const i = parseUtterance("Alexa, I need a gastroenterologist, an allergist for my five-year-old, and an orthopedist for my little one. He's under two.", null);
  assert.deepEqual(i, { kind: "tool", name: "find_in_network", args: { requests: [
    { member: "Mom", specialty: "gastroenterology" },
    { member: "Older child", specialty: "allergy", age_for_this_search: "5" },
    { member: "Youngest", specialty: "orthopedics", age_for_this_search: "under 2" },
  ] } });
});

test("scene 1 phrase -> checkup plan with items in the order said, lab work and oop", () => {
  const i = parseUtterance("Alexa, I've met my out-of-pocket max this year. I want a full checkup: primary care, OB-GYN, a dermatologist, a gastroenterologist and lab work. Book them all before my plan resets.", null);
  assert.deepEqual(i, { kind: "tool", name: "checkup_year", args: { action: "plan", items: ["primary_care", "ob_gyn", "dermatology", "gastroenterology", "lab_work"], oop_met: true } });
});

test("status, scene 2, yes/no, consent", () => {
  assert.deepEqual(parseUtterance("Alexa, what's left on my checkup plan?", null), { kind: "tool", name: "checkup_year", args: { action: "status" } });
  assert.deepEqual(parseUtterance("Alexa, find an orthopedist for my youngest. He's under two.", null), { kind: "tool", name: "find_in_network", args: { requests: [{ member: "Youngest", specialty: "orthopedics", age_for_this_search: "under 2" }] } });
  assert.deepEqual(parseUtterance("Yes.", "book"), { kind: "yes" });
  assert.deepEqual(parseUtterance("No thanks", "book"), { kind: "no" });
  assert.deepEqual(parseUtterance("Alexa, open In Network.", null), { kind: "tool", name: "consent", args: { action: "show" } });
  assert.deepEqual(parseUtterance("Allow.", "consent"), { kind: "tool", name: "consent", args: { action: "allow" } });
  assert.deepEqual(parseUtterance("Not now.", "consent"), { kind: "tool", name: "consent", args: { action: "decline" } });
});

test("refusals come before any tool (N1, N7)", () => {
  assert.deepEqual(parseUtterance("Alexa, my son has a rash, who should we see?", null), { kind: "refuse", rule: "N1", line: LINE_N1 });
  assert.deepEqual(parseUtterance("Alexa, this is an emergency, he can't breathe", null), { kind: "refuse", rule: "N7", line: LINE_N7 });
  assert.equal(parseUtterance("find a dermatologist for my rash", null).kind, "tool");
});

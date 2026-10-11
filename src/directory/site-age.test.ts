// Must-light control for audit:sites: the parser finds age wording on synthetic pages and stays quiet on plain ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { minimumAgeStated, siteAgeStatements, visibleText } from "./site-age.ts";

test("site age: synthetic pages with a minimum age light up", () => {
  const cases: [string, number][] = [
    ["<p>We see patients ages 3 and older.</p>", 3],
    ["<li>Ages: 2 to 18</li>", 2],
    ["Our pediatric orthopedists treat children from birth to 21.", 0],
    ["Dr. Sample does not see children under 5.", 5],
    ["Patients 18 and older only, please.", 18],
    ["<div>Adults only</div>", 18],
    ["We treat patients of all ages.", 0],
    ["Minimum age is 12 years.", 12],
    ["Accepting patients ages <strong>three</strong> and up", 3],
  ];
  for (const [page, min] of cases) {
    const st = siteAgeStatements(page);
    assert.ok(st.length > 0, `found something in: ${page}`);
    assert.equal(minimumAgeStated(st), min, page);
  }
});

test("site age: plain pages stay dark (no false minimum age)", () => {
  for (const page of [
    "<p>Dr. Sample is a board-certified orthopaedic surgeon with 18 years of experience.</p>",
    "Call the front desk. Suite 300. Open Monday to Friday 8 to 5.",
    "<script>var age = 'ages 3 and up';</script><p>Sports medicine and joint replacement.</p>",
    "Founded in 1998, our practice has 12 physicians.",
  ]) {
    assert.deepEqual(siteAgeStatements(page), [], page);
  }
});

test("visibleText drops scripts, styles and tags", () => {
  assert.equal(visibleText("<style>p{}</style><p>Hello&nbsp;<b>there</b></p><script>x()</script>"), "Hello there .");
});

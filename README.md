# InNetwork

**InNetwork finds the right doctor for each person in your family — in their own plan's network, near home, taking new patients, and who sees a patient that age — and books the visit before you ever pick up the phone.**

An Alexa+ add-on: a self-hosted **MCP server (spec 2025-11-25, Streamable HTTP; 2026-07-28 on the same endpoint)** with MCP Apps screens for Echo Show. **Alexa+ is simulated in our web host** (Alexa+ add-ons are in preview with select partners), with the official MCP client and MCP Apps bridge in a 1280×800 device frame, no logos. Everyone in the demo is fictional; doctor names were checked against the national provider registry (NPPES) and match nobody.

> One sentence — "I need a gastroenterologist, an allergist for my five-year-old, and an orthopedist for my little one. He's under two." — becomes three people, three plans, three doctors in each one's own network. The doctors who can't see them are set aside **with the reason and its source** before anyone calls.

## Self-scoring against the judging criteria

| Criterion (verbatim) | What we built | Status | Where in the repo | Video |
|---|---|---|---|---|
| **Tech Implementation** — "How well is the project built, and how effectively does it use the required tech?" | MCP 2025-11-25 + 2026-07-28 on one endpoint through the SDK's own era routing; 9 tools, 6 MCP Apps views; deterministic network gate (no model) with 13 refusals, each guarded by a test and a mutation check (16/16 killed); live FHIR Plan-Net query for the network step; state across sessions and restarts; independent Inspector CLI check on both eras | Built | `server/`, `src/core/`, `src/directory/`, `verify/`, `docs/inspector-2026-10-11/` | 0:00, 1:53 |
| **Design** — "complete, coherent product experience … interaction model intuitive … for the target device" | Voice first, screen second: one sentence → one screen for three people; read-back before booking, voice + written confirmation, cancel anytime (§15); short replies (107 words of Alexa in the whole video); screens follow the Alexa+ add-on design guide (768×480 base ×1.667, light and dark, type scale, one bright action) and were picked by the author from image-first mockups | Built | `views/`, `host/`, `design/screens/` | 0:00–1:53 |
| **Potential Impact** — "credible, specific case for solving customer needs … audience beyond the hackathon" | A real family's problem (three plans, a referral that failed on age, an hour per call); a reproducible audit: **0 of 8,506 public directory records state what age a doctor sees** (`npm run audit:directories`: five insurers' public directories measured — a sixth, Molina, hit its daily quota and is reported as not measured — 3 Orlando ZIPs); any family whose members are on different plans | Built | `packages/plannet-directory-check/`, `docs/AUDIT-*.md` | 0:18 |
| **Quality of the Idea** — "creative, imaginative use of the required tools … understanding of the developer ecosystem and the end-user needs" | Agentic workflow across services (directory → booking → calendar → Alexa app + email), context that persists (checkup year, family routine, the parent's own notes), MCP Apps; why native Alexa+ doesn't do this today (see below) | Built | `server/tools.ts` | 0:18, 0:35 |

| Submission rule | Status | Where |
|---|---|---|
| Alexa+: self-hosted MCP server (2025-11-25+, Streamable HTTP), called in code | Built | `server/server.ts`, `server/tools.ts` |
| Simulated Alexa+ experience: simulation source in the repo, demo shows it working | Built | `host/`, `scripts/demo.ts` |
| Demo video < 3 min, English, no third-party marks or music | ⏳ rough cut; author's voice Fri 16.10 | `docs/video/` (not in git) |
| Product feedback (5 questions) | Draft | `docs/PRODUCT-FEEDBACK.md` |
| Friction log (optional, up to +10%) | Draft | `docs/FRICTION-LOG.md` |
| Feature requests (optional) | Draft | `docs/FEATURE-REQUESTS.md` |
| Open Source mini challenge: a new open-source project in the window | Built (to be published as its own repo) | `packages/plannet-directory-check/` |

## Try it in 5 minutes (offline, no keys)
```
npm ci
npx playwright install chromium     # first time only, for verify
npm run demo                        # open the host URL it prints and press "Play demo"
npm run verify                      # every check + every beat in headless Chromium; exit 1 on any failure
```
Expected: Play demo walks consent → the three-person opening → the checkup year (booked around daycare) → a new conversation ("what's left") → the youngest's full search → the behind-the-scenes view. `DIRECTORY_MODE=auto npm run demo` adds the live Florida Blue network check to the developer view (internet needed; the cards still come from the recorded sample).

## What's new — and why native Alexa+ doesn't do this today
Today an assistant can book a table or a salon. Matching a doctor to each person's plan and age still takes phone calls. Alexa+'s documented booking path (Local Booking SPI, Jul 21, 2026) covers salons, spas and fitness — health, clinics and insurance are not mentioned. **We did not find anyone who** checks several people's different plans in one request, sets aside doctors who don't see a child's age with the reason and its source, and lays the visits out around the family's routine before the plan year resets.

## The "no"s, in code
Every refusal is a deterministic check (no model) with a test, and a mutation check proves the test is real: the refusal is removed in a throwaway copy and the test must turn red (`npm run mutations`, 16/16).

| # | InNetwork never… | Code | Test |
|---|---|---|---|
| N1 | picks a specialty or reads symptoms (tools have no symptom field; a symptom without a specialty gets a fixed answer) | `src/core/lint.ts` `refusalFor`, `server/tools.ts` schemas | `N1-symptom-refusal`, verify N9 |
| N2 | books out of network without a second explicit yes | `src/core/network-gate.ts`, `book_visit` | `N2: …`, mutation M-N2/M-N2b |
| N3 | sets aside or approves by age silently (three outcomes, each with a source; taxonomy never decides) | `network-gate.ts` `ageOutcome` | `N3: …` |
| N4 | stores a child's age, name, date of birth or plan type (age band is a request parameter only) | `server/store.ts`, `find_in_network` | `N4 …`, verify G1, M-N4 |
| N5 | reads a member ID aloud | `lint.ts` | `N5 …` |
| N6 | looks anything up before consent with a stated purpose | `consent` tool, gate in every tool | verify T1 |
| N7 | promises emergency help | `lint.ts` | `N7 …` |
| N8 | says "verified" when the directory didn't answer | `network-gate.ts` | `N8 …` |
| N9 | says "free"; coverage lines say "usually" and name the source | `lint.ts` | `N9 …`, verify G2 |
| N10 | books lab work before the primary care visit | `src/core/checkup.ts` | verify T12, M-N10 |
| N11 | gives a real doctor demo slots, an age policy or a booking | `server/tools.ts` `slotsOf` | `N11 …`, M-N11 |
| N12 | books over the family routine without a yes | `src/core/schedule.ts` | `N12 …`, M-N12/M-N12b |
| N13 | turns the parent's notes into a rating, shares them, or lets them reorder results | `network-gate.ts` (no notes input), `store.ts` `savePolicy` | `N13 …`, M-N13/M-N13b |

## Data: what is live, what is a file, what is a sample
| Person | Plan on screen | Source | Mode |
|---|---|---|---|
| Mom | Plan A | Florida Blue provider directory, FHIR Plan-Net — BlueChoice PPO (plan_id `BCHPPO`, network `PPC-2026-BCHPPO`) | LIVE in `auto`; recorded sample (names and offices changed) on the cards |
| Older child | Plan B | Oscar Health (FL) machine-readable provider file, CMS QHP JSON — Silver Classic Standard (HIOS `21525FL0010009`) | FILE (no API exists for marketplace plans); recorded sample on the cards |
| Youngest | Plan C | Molina Healthcare of Florida provider directory, FHIR Plan-Net — Medicaid Managed Medical Assistance (network `15`) | LIVE in `auto`; recorded sample (names, offices and the specialty label changed — disclosed per record) on the cards |

Office age policies ("doesn't see children under 3") are not in any directory. In production they are learned once at a booking and kept as a property of the office — no family data — so the next family is spared the call. In this demo they are sandbox data and every line built from them says "demo data". Slots, booking, calendar and the written confirmation are a sandbox partner.

## Children's data — what we hold and why
The parent is the user. A child appears as a relative label ("Youngest") and a plan label ("Plan C"). The age band the parent says ("under two") is used for that one search and never stored; verify scans every household file for age, name, date-of-birth and program-type keys. Policy §4 vs §13 for a parent-directed health navigator is unclear — we minimized, simulated, and filed a clarification request (`docs/FEATURE-REQUESTS.md` FR3). We do not claim policy compliance; the design follows the policy and is simulated.

## The number
`npm run audit:directories` (package `plannet-directory-check`), 2026-10-11, 3 Orlando ZIPs (32801, 32803, 32806) × the six specialties of the demo, anonymous GETs to six public insurer directories (five answered; Molina was over its daily quota):

**0 of 8,506 public directory records (4,170 practitioner roles + 4,336 locations) state what patient ages are seen.** The counter is proven on a synthetic record ("Ages 3 and up" → counted; plain record → not). 283 requests, 3 errors (Molina's daily quota → "not measured" for Molina, said so in the report). Also measured: office hours on 16.8% of records; a "new patients" flag on 88.6%; 25 of 474 NPPES individuals found by ZIP practice somewhere else unless `address_purpose=LOCATION` is added. Full table: `docs/AUDIT-2026-10-11.md`.

`npm run audit:sites` — 30 in-network orthopedists (Plan A, Orlando): the directory carries a website for none of them; of the practice pages we could find, 6 opened for an automated read and **0 of 6 state a patient age**, 10 refused automated reads (robots.txt or 403), 10 practitioners had no own page, and 4 of 30 are listed at Orlando addresses while their current profiles place them in another state. Only totals are published (`docs/AUDIT-SITES-2026-10-11.md`); the second measurement is thin and we say so.

Public insurer directories don't say what age a doctor sees, so there is nowhere to check in advance — you find out on the phone.

## Platform findings
1. **Alexa+ has no health-care booking path**: Local Booking SPI names salons, spas and fitness; no clinic profile, no plan or patient-age fields (`docs/FEATURE-REQUESTS.md` FR1, friction A4).
2. **FHIR Plan-Net has no structured patient-age field** (`newpatients.characteristics` is free text) — and in 8,506 records nobody fills it (FR2, friction F12).
3. **Marketplace plans publish files, not APIs**: one provider file is up to 1.5 GB; the demo reads Oscar's Florida file (friction F9).
4. **Directories disagree with themselves**: an insurance plan that points to a network no practitioner uses (Florida Blue, 5 of 14 plans, F3); a Medicaid plan record with an empty network (Molina, F7); an undocumented daily quota (Molina, F6b); `/metadata` hidden behind a gateway (Florida Blue, F1).
5. **Policy for a parent-directed health navigator is unclear** (§4 vs §13; FR3, friction A5).

## License
MIT — see `LICENSE`. Font: Nunito (SIL Open Font License 1.1, `@fontsource/nunito`).

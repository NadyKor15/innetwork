# Friction log — InNetwork (Alexa+ track)

Part 1 (A1–A8): the Alexa+ platform, MCP Apps and the add-on design guide. Part 2 (F1–F15): public provider directories, NPPES and CMS files — measured with `npm run audit:directories`. Every entry has the six fields the hackathon asks for: task · steps · expected vs actual · severity · workaround · suggestion. Feature requests that follow from these entries are in `docs/FEATURE-REQUESTS.md`.

## At a glance

| # | Entry | Severity |
|---|---|---|
| A1 | No way to run the add-on on Alexa+ outside the partner preview | High |
| A2 | `hostContext.theme` has no documented values; no host color or type tokens | Medium |
| A3 | The guide does not say who draws List / Card / Carousel | Medium |
| A4 | No health-care path in Alexa+ booking | Medium |
| A5 | Policy for a parent-directed health navigator is unclear | Medium |
| A6 | Design-guide minimum text sizes vs dense layouts | Low |
| A7 | On an Echo Show with Alexa+, "open In Network" does not reach the development skill | Medium |
| A8 | APL: a lone `payload` parameter receives the whole datasources object | Low |
| F1 | Florida Blue: no CapabilityStatement; supported search parameters only visible through an error message | Medium |
| F2 | Florida Blue: an unknown search parameter answers HTTP 200 + OperationOutcome | Medium |
| F3 | Florida Blue: InsurancePlan.network points to a network no practitioner role references (5 of 14 plans) | High |
| F4 | Florida Blue: specialty is free text with a NullFlavor code; sub-specialties are invisible | High |
| F5 | Florida Blue: every role says "accepting new patients"; no hours, no geo, no practice name | Medium |
| F6 | Molina: comma-separated ids return 0; one location per request; bursts get HTTP 403 | Medium |
| F6b | Molina: an undocumented daily call-volume quota stops every request until 00:00 UTC | High (live use) |
| F7 | Molina: Florida Medicaid MMA plan has an empty `network`; roles carry the program as network | Medium |
| F8 | Molina: shapes that break a strict Plan-Net reader | Low–medium |
| F9 | Marketplace (QHP) plans: no API; one provider file is up to 1.5 GB | Medium |
| F10 | NPPES: a ZIP search also matches mailing addresses | Medium (organizations), low (individuals) |
| F11 | Directories and indexes that need registration or refuse anonymous reads | Medium |
| F12 | No public directory record states a patient age (Plan-Net has no field for it) | High (families with young children) |
| F13 | Directory records that cannot answer the basic questions on their own | Medium |
| F14 | In-network listings at Orlando addresses for practitioners who report practicing elsewhere | Medium–high |
| F15 | Practice websites that refuse automated reads (the second measurement is thin) | Low for the build, medium for families |

The classic Alexa skill (`skill/`) ran on a real Echo Show 8 on Oct 20, 2026 (the live clip at 2:15 in the demo video); A7 and A8 are what we hit on the device. We only log what we actually tried.

## Part 1 — Alexa+ platform, MCP Apps, design guide

### A1. No way to run the add-on on Alexa+ outside the partner preview
- **Task:** show the MCP add-on working inside Alexa+.
- **Steps:** read the add-on docs and the hackathon forum; looked for a public toolkit or web simulator.
- **Expected vs actual:** expected a sandbox or simulator for builders; actual: "the Alexa+ Add-on toolkit and web simulator are in preview with select partners" (forum 45397).
- **Severity:** High (for any Alexa+ track entry).
- **Workaround:** our own host: official MCP client + MCP Apps bridge + a sandbox proxy on a second origin + a 1280×800 device frame (`host/`); a classic skill for one scene on a real Echo Show in development mode (`skill/`; tested against the server, run on an Echo Show 8 on Oct 20, 2026).
- **Suggestion:** publish the add-on simulator (even read-only, without commerce) so demos are comparable and closer to the device.

### A2. `hostContext.theme` has no documented values; no host color or type tokens
- **Task:** support light and dark mode natively, as the design guide asks.
- **Steps:** read Visual Foundations and Layout and Rendering (Jul 21, 2026) and the MCP Apps host context list.
- **Expected vs actual:** expected the value set of `theme` (and ideally host tokens); actual: `theme` is listed without values, no tokens are passed.
- **Severity:** Medium.
- **Workaround:** accept `"dark" | "light"`, treat anything else as dark; all colors as CSS variables switched by `data-theme`; the simulator sends `host-context-changed` to test both.
- **Suggestion:** document `theme` values and pass a minimal token set (surface, text, accent) in host context.

### A3. The guide does not say who draws List / Card / Carousel
- **Task:** decide whether our MCP App renders the list and card patterns or returns data for the host to render.
- **Steps:** Components and Patterns (Aug 03, 2026), Display modes, Layout and Rendering.
- **Expected vs actual:** expected a statement like "the host renders patterns from data X; apps render their own HTML otherwise"; actual: four patterns are named ("Don't invent alternatives") but the ownership is not stated.
- **Severity:** Medium.
- **Workaround:** our screens draw the patterns themselves in HTML that follows the guide's sizes; the host draws only the conversation strip and the add-on's logo bar.
- **Suggestion:** one paragraph and a minimal example of a data-only result rendered by the host.

### A4. No health-care path in Alexa+ booking
- **Task:** book a doctor's visit the "Alexa+ way".
- **Steps:** Local Booking SPI (Jul 21, 2026), integration-approach page (Jul 10, 2026).
- **Expected vs actual:** expected clinics or practitioners among supported businesses; actual: "salons, spas, fitness centers, and other appointment-based services", health/medical/doctor/clinic/insurance 0 mentions; no plan or patient-age fields in the booking contract.
- **Severity:** Medium.
- **Workaround:** a sandbox booking partner behind our own tools; read-back, voice + written confirmation and cancel anytime per policy §15.
- **Suggestion:** a clinic profile in the SPI with plan network and patient age group (feature request FR1).

### A5. Policy for a parent-directed health navigator is unclear
- **Task:** design what the add-on may hear and keep about a child.
- **Steps:** policy requirements (Jul 21, 2026) §3, §4, §13.
- **Expected vs actual:** expected guidance for an adult managing a child's appointments; actual: §4 "must never target children or collect their data" and §13 health rules do not address this case.
- **Severity:** Medium (blocks certification, not the demo).
- **Workaround:** the parent is the user; a child is a relative label and a plan label; the age band is a per-search parameter, never stored (verify G1, mutation M-N4).
- **Suggestion:** a short clarification with an allowed pattern (feature request FR3).

### A6. Design-guide minimum text sizes vs dense layouts
- **Task:** build week calendars at the guide's minimum sizes (Body3 12, Label1 10 at the 768×480 base).
- **Steps:** HTML from the picked mockups, 3–4 rounds of side-by-side checks per screen.
- **Expected vs actual:** expected the mockups' labels to fit; actual: "11:45–12:10" at 12 px is as wide as a calendar cell; "Gastroenterology" does not fit an 83 px column even at 10 px.
- **Severity:** Low.
- **Workaround:** labels only on the first day column, two-line tiles, Label1 for axis labels.
- **Suggestion:** a calendar/week example in Components and Patterns with recommended minimum cell sizes.

### A7. On an Echo Show with Alexa+, "open In Network" does not reach the development skill
- **Task:** open the classic skill (invocation name "in network", development stage) by voice on an Echo Show 8 that runs Alexa+.
- **Steps:** "Alexa, open In Network" and "Alexa, launch In Network" on the device and in the developer console simulator, on Oct 20, 2026.
- **Expected vs actual:** expected the skill's launch response; actual: Alexa+ answered "What would you like me to open?" and the skill got no request. "Alexa, open the In Network skill" worked: Alexa+ said "Here's In Network. Say "Alexa exit" to get back to Alexa plus." and then the skill answered.
- **Severity:** Medium (a tester who says the invocation name as documented sees nothing).
- **Workaround:** say "Alexa, open the In Network skill"; `skill/README.md` gives that phrase.
- **Suggestion:** under Alexa+, route "open <invocation name>" to an enabled development skill, or say in the testing docs which phrase reaches it.

### A8. APL: a lone `payload` parameter receives the whole datasources object
- **Task:** show the "Your checkup year" card on the Echo Show.
- **Steps:** `mainTemplate.parameters: ["payload"]`, the card under `datasources.payload`, bindings `${payload.card.*}`.
- **Expected vs actual:** expected `payload` to be `datasources.payload`; actual: on the device every `${payload.card.*}` rendered empty (only the header and one check showed), because a single parameter named `payload` gets the whole datasources object.
- **Severity:** Low (once known).
- **Workaround:** the parameter is named `innetwork` and the datasource key matches; the skill test fails on any binding through `payload`.
- **Suggestion:** a warning in the APL authoring tool when the only parameter is `payload` and a datasource key of the same name exists.

---

## Part 2 — public provider directories, NPPES, CMS files

Each entry: task · steps · expected vs actual · severity · workaround · suggestion, with the command and the number
measured. Times are UTC from the machine clock. All requests were anonymous GETs to public endpoints (no keys, no
registration). Entries marked *(to re-measure in the audit)* come from the 2026-10-11 02:1x–02:2xZ spike and are
re-counted by `npm run audit:directories`.

---

### F1. Florida Blue: no CapabilityStatement; supported search parameters only visible through an error message
- **Task:** find out how to ask the Florida Blue Plan-Net directory for "practitioners of a specialty in a ZIP, in plan P's network".
- **Steps:** `GET {fb}/metadata` → **404** (`{"httpCode":"404","httpMessage":"Not Found"}`), 2026-10-11 04:30Z. Then `GET {fb}/PractitionerRole?zzzbogus=1` → HTTP 200 with an OperationOutcome listing the valid parameters.
- **Expected:** `/metadata` returns a CapabilityStatement (FHIR R4 servers SHALL support it; Plan-Net CapabilityStatement lists the search parameters).
- **Actual:** the gateway hides `/metadata`. The error text says PractitionerRole supports `_id, _language, _lastUpdated, active, date, email, endpoint, identifier, location, organization, phone, practitioner, role, service, specialty, telecom` — **no `network`** (Plan-Net's `PractitionerRole-network` search parameter).
- **Severity:** medium (a client following the IG cannot discover the server).
- **Workaround:** `FhirClient.probeSearchParams()` sends an unknown parameter and parses the list; chained search `location.address-postalcode` works.
- **Suggestion:** expose `/metadata` through the gateway; support the Plan-Net `network` search parameter on PractitionerRole.

### F2. Florida Blue: an unknown search parameter answers HTTP 200 + OperationOutcome
- **Task:** detect failed searches in a sweep.
- **Steps:** `GET {fb}/PractitionerRole?zzzbogus=1` → **HTTP 200**, body `OperationOutcome` severity `error`.
- **Expected:** HTTP 400 for an unknown parameter (or the parameter ignored and reported).
- **Actual:** 200 — a client that checks only the status reads it as "0 results".
- **Severity:** medium (silent false negatives in audits).
- **Workaround:** the package treats a 200 OperationOutcome with severity error as an error of kind `outcome` and counts it.
- **Suggestion:** return 400 with the OperationOutcome.

### F3. Florida Blue: InsurancePlan.network points to a network no practitioner role references (5 of 14 plans)
- **Task:** go plan → network → practitioner, as Plan-Net draws it (InsurancePlan.network → Organization(plannet-Network) ← PractitionerRole network-reference).
- **Steps:** `GET {fb}/InsurancePlan?_count=50` (27 plans, 14 named) and `GET {fb}/Organization?type=…OrgTypeCS|ntwk&_count=100` (34 networks); then every PractitionerRole at locations in ZIP 32801 (837 roles, 9 pages) and the BlueOptions roles in ZIP 32803 (3,928 roles, 40 pages), 2026-10-11 04:3xZ, 0 errors.
- **Expected:** a role of plan BOPT ("BlueOptions") references the network that InsurancePlan BOPT lists.
- **Actual:** InsurancePlan BOPT lists `Organization/8139745` = `NWBOPTONE-2026-BOPT`; **3,928 of 3,928** BOPT roles in 32803 reference `Organization/8139768` = `NWB-2026-BOPT`, **0** reference 8139745. Same pattern for BOHS, BOPTIHDH (NWBOPTONE listed, NWB used) and BlueMedicare BMPPO, BMV (MAPPOOPT* listed, MAPPO used). 9 plans are consistent (BCHPPO, BMGPPO, BMP, BMPATPPO, BMPREF, BOTIP, BOV, BOVD, MMHMO).
- **Severity:** high for anyone answering "is this doctor in my plan's network?" by the IG's own chain: for BlueOptions the strict chain returns 0 doctors.
- **Workaround:** we use BlueChoice (BCHPPO: InsurancePlan network = role network = `PPC-2026-BCHPPO`) for the demo, and filter by the vendor identifier `https://www.edifecs.com/fhir/cms-organization/plan_id`.
- **Suggestion:** list every network a plan uses in InsurancePlan.network (NWB, NWBOPTONE, NWBOPTTWO), or point roles at the listed one.

### F4. Florida Blue: specialty is free text with a NullFlavor code; sub-specialties are invisible
- **Task:** find gastroenterologists in plan P's network in a ZIP.
- **Steps:** BlueOptions roles in ZIP 32803 (3,928), 2026-10-11 04:3xZ; `specialty:text=GASTRO` in ZIPs 32801/32803/32804/32806.
- **Expected:** `specialty` coded with NUCC taxonomy (Plan-Net binds PractitionerRole.specialty to NUCC), e.g. 207RG0100X Gastroenterology.
- **Actual:** **3,610 of 3,928** roles have `coding: v3-NullFlavor UNK` + a classification text ("INTERNAL MEDICINE"); only optometrists (91) and psychologists (77) carry NUCC codes. "GASTRO" finds **0** in all four ZIPs; gastroenterologists are filed under "INTERNAL MEDICINE" (889 roles in 32803).
- **Severity:** high (a sub-specialty cannot be searched in the directory alone).
- **Workaround:** join on NPI with NPPES: `taxonomy_description=Gastroenterology&postal_code=32803&address_purpose=LOCATION` → 19 individuals with 207RG0100X; 4 of them have a BlueChoice role at a location in 32803.
- **Suggestion:** send the NUCC code (classification + specialization) the provider registered.

### F5. Florida Blue: every role says "accepting new patients"; no hours, no geo, no practice name
- **Task:** show "accepting new patients", hours and distance on a card.
- **Steps:** BlueOptions roles in ZIP 32803 (3,928) and their Locations, 2026-10-11 04:3xZ.
- **Expected:** `newpatients` varies by practice; Location has `position` and a practice `name`; hours where known.
- **Actual:** `newpatients` = `newpt` on **3,928 of 3,928** roles; `availableTime` on **0 of 3,928**; Location `name` is the street line ("5201 RAYMOND ST"), no `position`. One dermatology role lists 5 locations in 4 cities (Orlando, Gainesville, Tampa area codes).
- **Severity:** medium (a uniform "accepting" carries no information; distance needs a geocoder).
- **Workaround:** distance shown only for our fictional offices (fixtures); live records show `distanceMi: null`.
- **Suggestion:** populate `newpatients` from the practice, `Location.position`, and the practice name.

### F6. Molina: comma-separated ids return 0; one location per request; bursts get HTTP 403
- **Task:** practitioners of the Florida Medicaid MMA network at locations in a ZIP.
- **Steps:** `GET {molina}/Location?address-postalcode=32801` (42 locations); `PractitionerRole?location=<id1,id2,…>&network=15` → **0**; `PractitionerRole?location=710235644&network=15` → **119**; same with `Location/` prefix → 0; `_include=PractitionerRole:location` with `network=15` → **HTTP 500**; 42 per-location requests at concurrency 6 → **16 × HTTP 403**; 2026-10-11 04:4xZ.
- **Expected:** FHIR OR-lists (`location=a,b`), reference values with the type prefix, `_include` as advertised in the CapabilityStatement (`searchInclude: *`).
- **Actual:** see numbers; a ZIP costs one request per location (42 for 32801, 426 for 32806), paced.
- **Severity:** medium (a live lookup per ZIP takes tens of seconds).
- **Workaround:** per-location strategy with a pause (300 ms) and a deadline; warm cache.
- **Suggestion:** support OR lists and chained `location.address-postalcode`, or document the rate limit.

### F6b. Molina: an undocumented daily call-volume quota stops every request until 00:00 UTC
- **Task:** capture orthopedic roles of the MMA network around ZIP 32803 (one request per location, paced 250–350 ms, one client at a time).
- **Steps:** per-location sweep from 04:46Z; at ~05:09Z every request (including `Location?address-postalcode=32806`) → **HTTP 403** `{"statusCode":403,"message":"Out of call volume quota. Quota will be replenished in 18:51:37."}`; re-checked 05:14:55Z → "18:45:05" left, i.e. reset at 2026-10-12 00:00Z. Roughly 1–1.5 thousand Molina requests had been made since 04:40Z (estimate from the sweep logs; not counted exactly).
- **Expected:** a documented rate/volume limit (headers such as `RateLimit-*` / `Retry-After`), or limits sized for a directory meant for public apps.
- **Actual:** no header, no documentation; one ZIP costs 40–430 requests (F6), so a few ZIPs exhaust the day.
- **Severity:** high for a live consumer (the directory is gone for the rest of the UTC day; the add-on must show "not confirmed — directory didn't answer", N8).
- **Workaround:** probe for Plan C uses the live answer of `npm run directory:warm` (its own asOf) and otherwise a deadline; the samples were built from Molina answers captured before the stop (`fixtures/directory/plan-c.orthopedics.meta.json` says which fields changed).
- **Suggestion:** publish the quota and send `Retry-After`; support OR lists / chained search so a ZIP is one request (F6).

### F7. Molina: Florida Medicaid MMA plan has an empty `network`; roles carry the program as network
- **Task:** link "Plan C" (Florida Medicaid managed care) to the practitioners in its network.
- **Steps:** `GET {molina}/InsurancePlan?name=MMA` → 3 plans (`FL-QMXBP1516` "MANAGED MEDICAL ASSISTANCE (MMA) BENEFIT PLAN", `FL-QMXBP8053`, `FL-QMXBP8115`), all with `network: []`; `GET {molina}/Organization/15` = plannet-Network "Medicaid-Managed Medical Assistance (MMA)"; `PractitionerRole?network=15` total **189,732**; 2026-10-11 04:4xZ.
- **Expected:** InsurancePlan.network → Organization/15.
- **Actual:** the plan → network link exists only by name.
- **Severity:** medium.
- **Workaround:** Plan C = network `15` named in our plan table (`src/directory/plans.ts`).
- **Suggestion:** fill InsurancePlan.network.

### F8. Molina: shapes that break a strict Plan-Net reader
- **Task:** read NPI, new-patient status and validity dates.
- **Steps:** any Molina PractitionerRole, e.g. from `PractitionerRole?organization=1000068679` (11,405 roles).
- **Expected:** `identifier.system = http://hl7.org/fhir/sid/us-npi`; `newpatients` with sub-extension `acceptingPatients`; real `period`.
- **Actual:** NPI as `identifier.type.coding.code = NPI` with no system; `newpatients` carries `valueCodeableConcept` directly; `period` = `1111-01-01 … 9999-09-09`; `organization` search works only with a bare id (`organization=Organization/…` → 0).
- **Severity:** low–medium.
- **Workaround:** readers accept both shapes (`npiOf`, `newPatientsOf` in the package).
- **Suggestion:** follow the Plan-Net profiles.

### F9. Marketplace (QHP) plans: no API; one provider file is up to 1.5 GB
- **Task:** "in network of an Oscar Florida marketplace plan".
- **Steps:** `GET https://d3ul0st9g52g6o.cloudfront.net/ffm/cms-data-index.json` → 35 provider files, 0.11–1.52 GB each (≈17 GB); first 128 KB of each read to locate Florida plan ids → `providers_3/4/5.json`; each read in full by streaming: 233,769 / 233,533 / 233,162 provider objects in 30 / 23 / 11 s, 0 errors, 2026-10-11 04:4xZ.
- **Expected:** a query interface (as Medicare Advantage / Medicaid have under CMS-9115-F).
- **Actual:** files only (CMS FAQ: QHP issuers "did not require … through an API"); no index by state or plan, so finding a plan's providers means reading gigabytes.
- **Severity:** medium (needs a warm step; impossible inside a voice turn).
- **Workaround:** streaming reader with a byte ceiling (`scanJsonArray`), warm cache.
- **Suggestion:** split provider files by state/plan in the index, or add a plan → file map.

### F10. NPPES: a ZIP search also matches mailing addresses
- **Task:** practices in an Orlando ZIP.
- **Steps:** spike 2026-10-11 02:2xZ: `…?version=2.1&state=FL&taxonomy_description=Urgent+Care&postal_code=<an Orlando ZIP>` → 4 of 8 organizations practice in other cities. Audit 2026-10-13 12:34Z (`npm run audit:directories`, individuals, 3 ZIPs × 6 specialties, 36 requests, 0 errors): **25 of 475** results (5.3%) have no practice address (primary LOCATION or secondary practice location) in the searched ZIP; with `address_purpose=LOCATION` the same queries return 450. (Earlier run 2026-10-11 05:28Z: 25 of 474, 449; superseded by `docs/AUDIT-2026-10-13.md`.)
- **Expected:** a postal-code search returns practices located in that ZIP.
- **Actual:** it also matches mailing addresses (half of the urgent-care organizations in the spike, 5.3% of individuals in the audit).
- **Severity:** medium for organizations, low for individuals.
- **Workaround:** `address_purpose=LOCATION`, and check secondary `practiceLocations` too (a LOCATION search matches them).
- **Suggestion:** make LOCATION the default for postal_code searches, or say so on the API page.

### F11. Directories and indexes that need registration or refuse anonymous reads
- **Task:** read Aetna and Elevance (Simply) directories; read Florida marketplace indexes.
- **Steps:** spike 2026-10-11 02:2xZ: Aetna `providerdirectorydata` → **401** "Invalid client id or secret"; Elevance `cms_mandate/mcd` Location without token → **500**. Audit 05:28Z: 26 Florida rows of the CMS Machine-readable URL PUF PY2026 (23 distinct index URLs) → **22 × 200, 1 × 403** (UnitedHealthcare, `www.uhc.com/…/cms-data-index.json`; also 403 three times of three in the spike).
- **Expected:** CMS-9115-F public directory APIs open without registration (Medicaid/MA); marketplace indexes publicly readable (45 CFR 156.122/156.230 machine-readable files).
- **Actual:** see codes.
- **Severity:** medium.
- **Workaround:** not used (no registration by design).
- **Suggestion:** open the directory endpoints as the rule intends; serve the index to non-browser clients.

### F12. No public directory record states a patient age (Plan-Net has no field for it)
- **Task:** know before calling whether a doctor sees a child that age.
- **Steps:** `npm run audit:directories` 2026-10-13 12:34–12:42Z: Florida Blue, Molina, UnitedHealthcare/Optum, Cigna, Humana, Centene (6 of 6 answered) × ZIPs 32801/32803/32806 × 6 specialties; 414 requests, 0 errors. (Earlier run 2026-10-11 05:28Z measured five directories — Molina was over its daily quota, F6b — 283 requests, 3 errors, 0 of 8,506; superseded by `docs/AUDIT-2026-10-13.md`.)
- **Expected:** an age range where a practice limits ages; Plan-Net offers only `newpatients.characteristics`, a free string.
- **Actual:** **0 of 10,075** records (5,649 PractitionerRole + 4,426 Location) state a patient age in any text field we read (characteristics, comments, descriptions, eligibility, string extensions); the must-light control on a synthetic "Ages 3 and up" record counts it.
- **Severity:** high for families with young children (an unsuitable referral is found out on the phone).
- **Workaround:** office policy learned once at a booking, kept per office without family data (SPEC §4.2; demo data in the add-on).
- **Suggestion:** a structured patient-age range in Plan-Net (e.g. a coded extension on `newpatients` or HealthcareService.eligibility with an age range), and directories populating it.

### F13. Directory records that cannot answer the basic questions on their own
- **Task:** specialty, NPI, new-patient status and hours from one PractitionerRole.
- **Steps:** same audit run (F12).
- **Expected:** PractitionerRole carries specialty (Must Support in Plan-Net) and the NPI (on the role or one hop away); `newpatients` informative; hours where offered.
- **Actual:** UnitedHealthcare/Optum: **435 of 1,500** roles carry a specialty, **341 of 1,500** an NPI. Humana: **0 of 910** roles carry an NPI (it sits on Practitioner, by absolute URL). Florida Blue: `newpatients` = `newpt` on **4,932 of 4,932** records; hours on **0 of 4,932**. Hours across all six directories: **3,006 of 10,075** records (29.8%). Hours conflicts inside one record: **0 found** in this run (Molina included: 1,571 records, hours on all of them).
- **Severity:** medium.
- **Workaround:** joins (Practitioner, NPPES by NPI), and never showing hours or "accepting" as verified.
- **Suggestion:** populate specialty and NPI on the role; vary `newpatients` by practice.

### F14. In-network listings at Orlando addresses for practitioners who report practicing elsewhere
- **Task:** call or book an in-network orthopedist the directory lists at a central Orlando address.
- **Steps:** `node scripts/audit-sites.ts --candidates` 2026-10-11 05:3xZ: Florida Blue BlueChoice (network PPC-2026-BCHPPO), orthopedics, ZIPs 32803/32806/32801 → 108 practitioners (distinct NPI) at 12 addresses; 30 taken round-robin over the addresses; each NPI looked up in NPPES (`?version=2.1&number=<npi>`, 30 requests, 0 errors).
- **Expected:** a practitioner listed at an Orlando location practices there (or at least in Florida).
- **Actual:** **4 of 30** report no practice address in Florida to NPPES (Arizona, Pennsylvania, Texas, New Jersey). For 4 of 30 a web search found a current out-of-state employer profile (not opened; NPPES lists that state for all 4). The directory carries a website for **0 of 30**. Several of these names match Orlando training programs (fellows/residents who moved on) — our reading, not verified.
- **Severity:** medium–high (a family calls a doctor who is not there).
- **Workaround:** cross-check NPPES practice addresses; never present a directory row as "available".
- **Suggestion:** retire listings when a practitioner leaves; publish the practice URL (`telecom` system `url`).

### F15. Practice websites that refuse automated reads (the second measurement is thin)
- **Task:** read 44 practitioners' own pages (orthopedics 16, allergy 10, dermatology 18; 71 looked up, 21 with no own page found, 6 practising in another state) for the patient ages they see (`npm run audit:sites`, robots.txt honoured, one GET per page, 2 s per host).
- **Steps:** 2026-10-11 05:3xZ (orthopedics), 06:4xZ (all three specialties; `node scripts/audit-sites.ts --keep-text`).
- **Expected:** public bio pages readable by a polite client.
- **Actual:** **26 of 44** pages did not open: robots.txt answered with a bot-checkpoint status (**HTTP 429** on one health-system host, **403** on two) or the page itself answered **403** (two hosts), so we read nothing; one search hit was a stale URL (404). 20 of the 26 are hospital-system doctor profiles. Of the **18** pages that opened, **0** state a patient age (an independent, broader grep of the saved page text, every hit read: no minimum or maximum age anywhere; 8 of 18 mention children or a pediatric service with no number). Allergy has only 11 in-network practitioners in the three default ZIPs plus neighbours (3 in the default three). Parser control on synthetic pages lit.
- **Severity:** low for us (measurement), medium for families (the age is not written anywhere a family can find it in advance; you learn it on the phone).
- **Workaround:** none taken (no bot-checkpoint bypass by design); result published with its counts.
- **Suggestion:** structured age data in the directory (F12) instead of scraping practice pages.

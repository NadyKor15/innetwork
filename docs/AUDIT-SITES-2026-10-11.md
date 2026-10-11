# Practice websites vs the insurer directory — 2026-10-11

- Run: 2026-10-11T06:45:44.947Z · command: `npm run audit:sites` (input: 71 practitioners, local file, not published)
- Practitioners: in-network for Plan A (Florida Blue BlueChoice, network PPC-2026-BCHPPO), up to 30 per specialty (kept: allergy 11, dermatology 30, orthopedics 30), spread over the directory's practice addresses (round-robin). ZIP sets: allergy: 21 ZIPs (the three default Orlando ZIPs 32803/32806/32801 plus neighbouring ones, because the default three hold too few in-network practitioners of this specialty); dermatology: 3 ZIPs (32803, 32806, 32801); orthopedics: 3 ZIPs (32803, 32806, 32801). The practitioner's own page was looked up by a manual web search (the directory carries a practice URL for 0 of 71); third-party directories (Healthgrades, Zocdoc, Vitals, WebMD, Doximity, Sharecare, NPI registries and the like) were not counted as a practice's own page; a hospital system's doctor profile was.
- Identity control: 15 of 18 opened pages name the practitioner (the other 3 are practice-level pages).
- Method: robots.txt honoured, one GET per public page, 2 s between requests to a host, no forms, no calls; visible text parsed for patient-age wording (`src/directory/site-age.ts`).
- Parser control (synthetic pages, this run): "ages 3 and older" found = **true**, plain bio page stays quiet = **true**.
- Pages that did not open: **26** of 44 (robots disallowed 0, robots.txt unavailable 12, HTTP error or timeout 14). Reasons (host names are not published): page HTTP 403 (13 pages, 2 hosts); robots.txt HTTP 429 (7 pages, 1 host); robots.txt HTTP 403 (5 pages, 2 hosts); page HTTP 404 (1 page, 1 host). When robots.txt itself is refused we do not read the page.

**0 of 18 practice pages that opened state a minimum patient age (0 of 18 say anything about ages); the insurer directory says nothing about age for all 71 practitioners.**

By specialty:

| Specialty | Practitioners | Own page found | Opened | Minimum age stated | Any age wording | Did not open | No own page | Practises in another state |
|---|---|---|---|---|---|---|---|---|
| orthopedics | 30 | 16 | 6 | 0 | 0 | 10 | 10 | 4 |
| allergy | 11 | 10 | 2 | 0 | 0 | 8 | 0 | 1 |
| dermatology | 30 | 18 | 10 | 0 | 0 | 8 | 11 | 1 |
| **All** | **71** | **44** | **18** | **0** | **0** | **26** | **21** | **6** |

| Outcome | Practitioners |
|---|---|
| Own page states a minimum age (e.g. "ages 3 and up", "adults only") | 0 |
| Own page states all ages / children only / a range from birth | 0 |
| Own page opened, no age wording | 18 |
| Own page found but did not open for an automated read | 26 |
| No own page found | 21 |
| Current employer profiles found place the practitioner in another state | 6 |
| **Total** | **71** |

NPPES cross-check (practice addresses the practitioner reported to CMS): 7 of 70 have no practice address in Florida.

Names, addresses and per-site rows are not published; they stay in a local file.

<!-- manual-notes: kept across runs -->
## Independent check of the "0" (written by hand after the run; survives a re-run of the script)

- The parser found no age wording on any of the 18 pages that opened. To make sure the parser is not blind, the saved visible text of the same 18 pages (local, `audit-private/site-text/`, `--keep-text`) was searched with two other, broader patterns and every hit was read: (a) any sentence with age/aged/years old/infant/newborn/adolescent/pediatric/children/adult/birth; (b) any number next to "and up / and older / under / over / to N years / adults only / children only". Result: **no sentence on any of the 18 pages gives a minimum or maximum patient age.** All numeric hits were not patient ages (for example "over 13,000 procedures", "20+ providers", "over 10 years of experience"); one page gives "start routine skin exams by the age of 35", a screening tip, not an age policy. Control: the same patterns light on a synthetic "patients ages 3 and older" and stay quiet on "18 years in practice".
- What the pages do say: **8 of the 18** mention children or a pediatric service without any age number ("pediatric and adult patients", a "Pediatric Dermatology" item in a service menu, pediatric asthma and childhood allergies as conditions, a children's health system, a physician's pediatric training). That tells a parent the practice sees children, not from what age.
- Limits of this number: only **18 of 71** practitioners (25%) have a page that opened for an automated read. **26** pages did not open, of them 20 are hospital-system doctor profiles (the large systems answer robots.txt or the page itself with 403/429), 5 are practice-group or single-practice sites behind a bot check, 1 is a stale search hit (404). **21** practitioners have no own page that web search finds (only directories), 6 practise in another state. Nothing was bypassed. So this measures "pages a polite client can read", not "every practice's website"; a human with a browser could read the 26 and may find age wording there.
- Three of the 18 opened pages are practice-level (they do not name the practitioner), see the identity control above.

# Practice websites vs the insurer directory — 2026-10-11

- Run: 2026-10-11T05:39:40.735Z · command: `npm run audit:sites` (input: 30 practitioners, local file, not published)
- Practitioners: in-network for Plan A (Florida Blue BlueChoice, network PPC-2026-BCHPPO), orthopedics, directory locations in ZIPs 32803, 32806, 32801, spread over the directory's practice addresses (round-robin). The practitioner's own page was looked up by a manual web search (the directory carries no URL: 0 of 30); third-party directories were not counted as a practice's own page.
- Method: robots.txt honoured, one GET per public page, 2 s between requests to a host, no forms, no calls; visible text parsed for patient-age wording (`src/directory/site-age.ts`).
- Parser control (synthetic pages, this run): "ages 3 and older" found = **true**, plain bio page stays quiet = **true**.
- Pages that did not open: **10** of 16 (robots disallowed 0, robots.txt unavailable 7, HTTP error or timeout 3). Hosts that refused an automated read: www.orlandohealth.com (robots.txt 429), www.adventhealth.com (page 403), www.hcafloridahealthcare.com (robots.txt 403). When robots.txt itself is refused we do not read the page.

**0 of 6 practice pages that opened state a minimum patient age (0 of 6 say anything about ages); the insurer directory says nothing about age for all 30 practitioners.**

| Outcome | Practitioners |
|---|---|
| Own page states a minimum age (e.g. "ages 3 and up", "adults only") | 0 |
| Own page states all ages / children only / a range from birth | 0 |
| Own page opened, no age wording | 6 |
| Own page found but did not open for an automated read | 10 |
| No own page found | 10 |
| Current employer profiles found place the practitioner in another state | 4 |
| **Total** | **30** |

NPPES cross-check (practice addresses the practitioner reported to CMS): 4 of 30 have no practice address in Florida.

Names, addresses and per-site rows are not published; they stay in a local file.

# Evidence — every claim in the README, video and Devpost text, and how to check it

Rule: a claim goes into the submission only if it has a row here with a command or file a stranger can open, and it was checked by someone other than its author (a fresh `verify` run, another reviewer). Dates are UTC. Rows marked ⏳ are not claimable yet.

| # | Claim (as worded in the submission) | How a stranger checks it | Result | Checked (date, by) |
|---|---|---|---|---|
| E1 | Self-hosted MCP server, spec 2025-11-25, Streamable HTTP, strict sessions | `npm run verify` → P1, P3, N1, N5–N8 | PASS | 2026-10-11, verify run (quick, test-double directory) |
| E2 | 2026-07-28 served from the same endpoint through the SDK's era routing (no hand-written protocol code) | verify S4; `server/server.ts` (`isLegacyRequest` + `createMcpHandler`) | PASS | 2026-10-11, verify run |
| E3 | An independent MCP client accepts the server on both eras | `docs/inspector-2026-10-11/` (Inspector CLI 2.8.0: `tools/list --strict` 9 tools exit 0; `--app-info` 5 MCP App links; `tools/call consent`) | PASS both eras | 2026-10-11, Inspector CLI |
| E4 | State lives between conversations and survives a server restart | verify S1–S5 | PASS | 2026-10-11, verify run |
| E5 | Unknown session 404, foreign Origin 403, missing account link 401, someone else's session 403 | verify N1–N8 | PASS | 2026-10-11, verify run |
| E6 | The network gate is fixed rules, no model; same input → byte-identical decision | `src/core/network-gate.ts`; test "gate is deterministic"; no LLM dependency in `package.json` | PASS | 2026-10-11, unit tests |
| E7 | Every refusal (N1–N13) is enforced in code and guarded by a test that turns red when the refusal is removed | `npm run mutations` → 16/16 mutations killed; control on the unmutated copy green | 16/16 | 2026-10-11, mutation run |
| E8 | Alexa's lines in the video are exactly what the server says | verify T3, T8, T9, T11, S2, T13 (word for word) | PASS | 2026-10-11, verify run (test-double directory; ⏳ re-run on recorded samples) |
| E9 | Voice budget: 107 words of Alexa in the whole video, no reply over 20 s | verify G3; `src/core/lint.ts` `words()` | 107 words ≈ 42.8 s, longest 16.4 s | 2026-10-11, verify run |
| E10 | "plans usually pay 100% … — per HealthCare.gov" is attributed, never "free" (N9) | verify G2 (every line of a run passes the linter), test N9; source page ⏳ open in a browser before the voice recording (SPEC §10) | PASS (linter) | 2026-10-11 |
| E11 | Household files hold no ages, names, dates of birth or program types | verify G1 + test "N4 holds while the proposal waits"; mutation M-N4 | PASS | 2026-10-11 |
| E12 | A family's note about a doctor is private, never a rating, never reorders results, never reaches the shared office-policy file | tests N13-notes-private, "office policy keeps only its six fields"; mutations M-N13, M-N13b | PASS | 2026-10-11 |
| E13 | Real doctors from a live directory never get demo slots, age policies or a booking | test N11; mutation M-N11 | PASS | 2026-10-11 |
| E14 | Plan A's network step is checked against the live Florida Blue FHIR Plan-Net directory | ⏳ verify with `DIRECTORY_MODE=auto` + developer view LIVE row (directory lane) | ⏳ | — |
| E15 | "0 of N public directory records we checked say what age a doctor sees" | ⏳ `npm run audit:directories` → `docs/AUDIT-*.json` | ⏳ | — |
| E16 | Site check: "X of N in-network orthopedists state a minimum age on their own site; the directory says nothing for all N" | ⏳ `npm run audit:sites` → `docs/AUDIT-SITES-*.md` | ⏳ | — |
| E17 | Fictional doctor names match no real practitioner in NPPES (FL and US) | ⏳ `npm run guard:names` (control `Maria Garcia` lights, network errors printed) | ⏳ (spec-time check 2026-10-11 02:56Z/03:06Z: 0 matches) | — |
| E18 | Customer screens show no tool names, internal ids, JSON, source badges or stars | verify G4 | PASS (0 in 783 card strings) | 2026-10-11 |
| E19 | Screens are built from the images the author picked, with the Alexa+ design-guide rules applied (768×480 base, zoom 1.667, light and dark) | `design/screens/0N/` (reference HTML, notes, compare shots); ⏳ verify browser rows compare the live screens | ⏳ | — |
| E20 | Runs offline in two commands | ⏳ fresh `git clone` → `npm ci` → `npm run demo`; `npm run verify` | ⏳ | — |

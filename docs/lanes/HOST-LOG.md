# HOST lane log: Echo Show 8 simulator, MCP App views, demo, recording, browser checks

Branch `lane/host` (worktree `innetwork-alexa-wt-host`). Started 2026-10-11 04:47:55Z; entry 05:19Z, updated 05:23Z after main brought `src/directory` and the card labels (`date -u`).

## What is built

| Part | Files | What it does |
|---|---|---|
| Views | `views/screens.ts`, `views/screens.css` -> `dist/views/{family-match,set-aside,visit-plan,booked,checkup-year,consent}.html` | One bundle in six files. The screen is picked by `structuredContent.card.view`, not by the file name. The CSS is `design/tokens.css` verbatim, followed by the CSS of each reference `design/screens/0N-*/screen.html`, class for class, scoped by the screen root (`.s-fm`, `.s-cy`, `.s-vp`, `.s-bk`, `.s-sa`, `.s-cs`). Text goes in through `textContent` only. Theme comes from `hostContext.theme` (`data-theme`). Zoom comes from `deviceClass` `echo-show-8` (1.667 on the 768x480 base). Both follow `host-context-changed`. Allow / Not now on 06 -> `app.sendMessage`. Fonts are loaded from `__INNETWORK_ASSET_BASE__/assets/fonts/`. |
| Host | `host/index.html`, `host/host.ts`, `host/host.css`, `host/serve.ts`, `host/sandbox.ts` | Device frame with a true 1280x800 screen and the caption "Echo Show 8 simulator (1280x800 frame)". A permanent "Alexa+ simulated in our web host" mark sits on the bezel. Inside the screen, the host draws the 24-px add-on row (three circles + InNetwork, "demo data") and the conversation band in each reference's geometry: framed for 01/02, open with two short lines for 05, the quote of the request's last sentence for 03, none for 04/06. The view iframe sits below the band. The official MCP client runs over Streamable HTTP (`Bearer innet-sandbox-<user>`). Views go through AppBridge + a sandbox proxy on a second origin, with CSP from `_meta.ui.csp`. `ui/resource-teardown` is sent before every view change. `parseUtterance` handles intent: N1/N7 are spoken by the host without a tool call, "yes" -> `book_visit {confirm:true}`, "no" books nothing. Subtitles show each of `speechParts` in turn with its seconds; a line is shrunk to fit 2 lines and never cut. Controls: mic (Web Speech API if present), Play demo, New session, Reset, Theme (live `host-context-changed`), Behind the scenes. A developer view on the right shows chips per tools/call with `_meta.steps`, `_meta.gate` and LIVE/FILE/FIXTURE/SANDBOX/SIMULATED badges (outline/dashed), protocol, session and household. The full-screen "Behind the scenes" (screen 07) opens with `?view=developer` and automatically at the end of Play demo. It is built from `/devinfo` (plans with kind/program/source, live probes per plan, verify from `logs/verify-latest.json`, audits) and the latest `_meta.steps` / `_meta.gate`. No live probe -> "LIVE · no live directory call in this run · directory mode: …". No verify -> "verify — not run yet". |
| Build / demo | `build.ts`, `scripts/demo.ts`, `scripts/dev-host.ts` | `npm run demo`: build -> MCP (8797) + host (5188) + sandbox proxy (5189), env `MCP_PORT`/`HOST_PORT`/`SANDBOX_PROXY_PORT`, `DIRECTORY_MODE=fixture` by default, uses `src/directory`. `scripts/dev-host.ts` is the same against the test double `server/dev-directory.ts` (host-lane development only). |
| Play demo | `host/host.ts` (BEATS) | 1 open + Allow (06) · 2 opening (01) + Yes (01 Booked) · 3 checkup (03, two parts) + Yes (04) · 4 New session + "what's left" (02) · 5 youngest's orthopedist (05) · 6 behind the scenes (07) 7 s. New household every run. `body[data-demo|data-beat|data-hold]`, `window.__host` (turns, card renders/initialized/teardowns, devboard, errors). `?pace=fast` for checks, `?hold=1` pauses after every step until `window.__release()`. |
| Browser checks | `verify/browser.ts`, `verify/tools/{render,dom_check,_pw}.cjs`, `verify/tools/compare_to_image.py` | `runBrowserChecks({hostUrl, screensDir, mcpUrl})` -> Row[] (B1–B19). It is also standalone: `node verify/browser.ts --host <url> [--out docs/screens]`. |
| Recording | `scripts/record-demo.ts` (`npm run record`) | Silent 1920x1080 capture of Play demo -> `docs/video/innetwork-demo-silent.webm` + `.mp4` (ffmpeg), `innetwork-demo-alexa-lines.srt`, `innetwork-demo-beats.json` `{video, durationMs, beats[{beat,label,startMs,endMs}], cues[{atMs, who, text, beat}]}`. Subtitles are not burned in. |

## Checks run

On `src/directory` (recorded samples, `DIRECTORY_MODE=fixture`), after `git merge main` (d483919: lane/data + card labels):
- `npm test`: 48 tests, 47 pass, 0 fail, 1 skipped (live).
- `node verify/guards.ts`: G5–G8 PASS. G5 covers views/host/fixtures/demo.ts with 0 placeholder hits; the control finds 5.
- Clean install: in a throwaway worktree (lane/host + lane/data, since removed), `npm ci` then `npm run demo` came up: `/healthz` ok, host 200.
- `node scripts/demo.ts` on 8897/5288/5289 + `node verify/browser.ts --host http://127.0.0.1:5288/`: **19/19 PASS**.
  - B1: protocol 2025-11-25, session, 9 tools.
  - B2: frame is 1280x800 with the caption and the simulated mark; no img; no page scroll.
  - B3: tapping Allow -> ui/message -> consent.
  - B4: N1/N7 give fixed lines with 0 tools/call.
  - B5: "no" makes 0 book_visit calls.
  - B6: second origin. CSP has `default-src 'none'`, `font-src` = the MCP origin, `connect-src 'none'`. The host is unreachable from the view.
  - B7: the demo reaches done; views come in order.
  - B8: scene 1 parts appear in order, 7.6 s then 16.0 s.
  - B9: renders 11 = initialized 11; teardowns 10.
  - B10: theme 7/7 via host-context-changed.
  - B11: zoom 1.667 / echo-show-8 everywhere; Nunito loaded.
  - B12: dom_check clean in 15 documents.
  - B13: host page clean at every step, nothing below 1080.
  - B14: 0 forbidden strings.
  - B15: the 07 lines match /devinfo.
  - B16: compares, see the table.
  - B17: 0 console errors.
  - B18: bands 7/7.
  - B19: the controls light on synthetic defects and stay dark on clean text.
- Earlier, the same 19/19 also passed on the test double `server/dev-directory.ts` (`node scripts/dev-host.ts`).

| Screen | Snapshot | vs reference screen.html, edgeF1 / lumaMAE | light vs reference light | vs picked reference.png | dom_check in the view |
|---|---|---|---|---|---|
| 01 family match | `docs/screens/beat-2-family-match.png` | 1.000 / 0.0 | 1.000 / 0.0 | 0.349 / 21.8 | 0 wrapped · 0 clipped · 0 overlaps · fits |
| 02 checkup year | `docs/screens/beat-4-checkup-year.png` | 1.000 / 1.2 | 0.970 / 1.3 | 0.254 / 24.9 | 0 · 0 · 0 · fits |
| 03 visit plan | `docs/screens/beat-3-visit-plan.png` | 0.963 / 1.5 | 0.976 / 1.6 | 0.378 / 22.4 | 0 · 0 · 0 · fits |
| 04 booked | `docs/screens/beat-3-booked.png` | 0.999 / 0.1 | 1.000 / 0.2 | 0.280 / 23.8 | 0 · 0 · 0 · fits |
| 05 set aside | `docs/screens/beat-5-set-aside.png` | 0.996 / 0.2 | 0.996 / 0.2 | 0.370 / 18.5 | 0 · 0 · 0 · fits |
| 06 before we start | `docs/screens/beat-1-consent.png` | 1.000 / 0.0 | 1.000 / 0.0 | 0.330 / 18.9 | 0 · 0 · 0 · fits |
| 07 behind the scenes | `docs/screens/beat-6-developer.png` | 0.947 / 2.3 | 0.958 / 2.3 | 0.821 / 9.5 | 0 · 0 · 0 · fits (board) |

The "picked image" numbers are low on purpose; the reference notes give the same 0.25–0.37. The picked images have no 24-px top row, a purple background and filled check circles; STYLE removed all three. The light shots are `docs/screens/light-<view>.png`. Extra steps: `beat-1-consent-allowed.png`, `beat-2-family-match-booked.png`. Side-by-side compares are in `logs/screens-compare/compare-0N-{dark,light,picked}.png` and `metrics.json` (not committed). On 07 the live strip says "no live directory call in this run" and every plan shows FIXTURE: that is the truth in fixture mode.

Checked by eye (Read), 3 rounds:
1. Every beat against its reference shot. The 06 font was off and the view fell back to the 600 weight. Cause: a CSS comment containing `*/` swallowed the 400 `@font-face`. Fixed.
2. The 03 week was wrong (server bug, below). Fixed in main 56df6cd and merged. The "Booked" mark on 05 pushed the cards 2 px down; fixed. Long subtitle lines pushed the controls below 1080; now shrunk to fit 2 lines. 07 rows wrapped to 3 lines; the format text now goes only on rows that were really read.
3. Light theme on all 7, and the dev page at 1920x1080 from the recording frames.

Differences from the references that remain on purpose:
- 03 tiles sit strictly by their times. The `--nudge` of the reference is not carried over.
- 01/05 show `bookedLabel` and 04 shows `list[].note` from the card. The view has no words of its own.
- The 03 source line is the record provenance from the data ("In-network · directory record captured Oct 11, names and offices changed").

Recording (on `src/directory`, fixture, normal pace, 05:24Z): `node scripts/record-demo.ts --host http://127.0.0.1:5288/` -> demo done, 6 beats, 17 cues (8 mom, 9 Alexa), 108.0 s; webm 11.7 MB, mp4 10.9 MB (git-ignored); `docs/video/innetwork-demo-alexa-lines.srt` and `docs/video/innetwork-demo-beats.json` are committed. I looked at the frames at 25/60/95 s (and at 20/45/70/100 s of the first take on the double); the first take showed the 3-line subtitle problem, which is fixed.

## Not done / not checked

- The 07 LIVE strip and the per-plan LIVE FHIR badge come from `/devinfo.probes[planId].ok` and the live step summary. They have only been seen with no probes (fixture). I did not run `DIRECTORY_MODE=auto` here, to spare the Molina daily quota for the recording. Check in auto mode: the live line must show the directory, ref, ms and time; the count line must show the live step summary.
- The full `npm run verify` (verify/run.ts on 8797/5188) was not run from this lane, so as not to collide with the build lane's ports. `runBrowserChecks` has the signature that run.ts imports.

## Needed from the server (build lane)

1. ✅ done in main 56df6cd: `checkup_year` plan week started from "now + 1 day" (Mon Oct 12) instead of the week of the visits.
2. ✅ done in main b30cabf: `BookedCard.list[].note`, `fit.bookedLabel` / `fits[].bookedLabel`, `ageLabel` only where it explains a set-aside. The view now renders them from data. "Older child (5)" is gone; 01 vs reference = 1.000.

# notes-screen — InNetwork 02 Checkup year (variant A → screen.html)

Start: 2026-10-11T04:27:11Z · End: 2026-10-11T04:39:19Z (both from `date -u`).
Files: `screen.html`, `assets-screen/` (empty, see below), renders `shots/screen-v1..v4.png`, `shots/compare-screen-v1..v4.png`, `shots/diff-screen-v1..v4.png`, `shots/screen-light.png`.

## How it was matched
- Positions: edges found by brightness profiles (`work/edges.py`, `work/hproj.py`, `work/baseline.py`), image px × 0.4842 → base px. Font sizes from "ink width in image ÷ ink width of the same string in Nunito" (`work/measure.js`); baselines placed from line-box math (baseline = LH/2 + 0.329·fs for Nunito).
- Canvas: body 768×480 base px, `html{zoom:1.667}` → render exactly 1280×800, overflow hidden, no scroll.
- The official compare cannot line up: by STYLE the whole content moves down 24 base px (new top bar) and the background is #14181E instead of the image's purple. So official edgeF1/lumaMAE stay low by construction. For real alignment I also used an aux check (`work/aux.py`): the image shifted down by the 24-base header, compared in the region above the week strip, plus a red/green edge overlay.

## Rounds
| Round | What I saw → what I fixed | official edgeF1 / lumaMAE | aux edgeF1 (shifted, top region) |
|---|---|---|---|
| v1 | First build from measurements. Overlay: band, title, subtitle, rows sit on the image within ~1 px. Problems: the Monday window label wrapped as "8:30–11:15 · while / he's at daycare"; the "·" separators were too tight (image has ~6 base px on each side); status line ~5 base px wider than the image. | 0.275 / 25.1 | 0.933 |
| v2 | Window label split as "8:30–11:15 ·" / "while he's at daycare"; real spaces + 1.5 px margin around every "·"; status line remeasured word by word (image "Booked" ink is 42.6 base, not 48.9) → status 13 px, notes 12.6 px; subtitle 15.2 px; source letter-spacing 0.12 px. Widths now within ±2 base px. | 0.276 / 25.0 | 0.947 |
| v3 | Time window was 40 tall vs 37.8 on the image → 38 (tiles 17, padding 1.5); strip card 139 tall; "12" axis label recentred on the pick-up row. Light theme rendered and checked. | 0.265 / 24.9 | 0.947 |
| v4 (final) | Data stress test (long specialty, long note, long tile name): tile name ran out of the coral tile → tiles may wrap to 2 lines (min-height instead of height); specialty got 8 px right padding so a 2-line name does not touch the icon. Rendered pixels of the real data changed only in the tile area (≤1 px). | 0.265 / 24.9 | 0.947 |

Final render: `shots/screen-v4.png`, side by side `shots/compare-screen-v4.png`.

## Checks
- `node dom_check.js … 1280` (v4): `{"wrappedNumbers":0,"wrappedEx":[],"clipped":0,"clippedEx":[],"cardOverlaps":0,"overlapEx":[],"width":1280,"height":1080}`. Height 1080 is dom_check's own viewport height; the page itself is 480 base = 800 px with overflow hidden (render.js reports `{"w":1280,"h":800}`).
- Light theme `shots/screen-light.png` (render with `?theme=light`) viewed: all text readable, logo in light colours, coral tiles with white text (`--on-accent` light), window tint, routine blocks faint but visible, nothing missing.
- Tokens: `:root` and `:root[data-theme="light"]` copied verbatim from tokens.css (diff = 0). Outside those blocks: 0 hex, 0 rgb(); everything via var(). Own variables in a second `:root` block (measured sizes only).
- One inline script only (the theme switch). `<meta charset="UTF-8">` is the first element in `<head>`. No JS beyond that, no canvas, no libraries; icons are inline SVG.
- Minimum type: everything for the customer ≥ 12 base px (Body3); 10 px (Label1) only on "demo data" and the axis labels 8/11/12. Label2 not used.
- Stress test: a 2-line specialty fits inside the fixed 28.8 px row; a long tile name wraps to 2 lines inside its window (single-tile days).

## By STYLE (differences from the picture made on purpose)
- by STYLE: background `--screen` #14181E instead of the warm purple; band, rows and week strip are `--card` with a 1 px `--hairline` frame (card and background are one colour); routine blocks `--card-inner`; window `--mom-window`.
- by STYLE: new top bar 24 base px: three-circle mark (inline SVG, 12 px high, fills `--mom`/`--older`/`--youngest`, so it switches to the logo-mark-light colours in light theme) + "InNetwork" 14 px/700, "demo data" 10 px `--text-3` on the right. Bottom logo and bottom "demo data" removed; all content moved down 24 base px.
- by STYLE: footer chain "directory → booking [SANDBOX] → calendar [SANDBOX] → Alexa app + email" removed (moved to screen 07). The freed bottom row is used by the taller week strip (below).
- by STYLE: status "fits" = outline check only in `--fits`, no circle, no fill (image: filled green circles).
- by STYLE: "unknown" = yellow "?" inside a thin outline circle `--unknown`, no fill (image: filled yellow circle).
- by STYLE: visit tiles coral `--mom` with dark text `--on-accent` (image: white text on coral, contrast 2.3:1).
- by STYLE: subtitle is one thought "Out-of-pocket max met · plans usually pay 100% of covered in-network care until Dec 31"; source line "Source: HealthCare.gov glossary · Check your plan for details" in Body3 12 px `--text-3` (image: ~10.6 base, lighter grey).
- by STYLE: week labels only in the Monday column, raised to 12 px (image ~9.3 base); day names raised to 12 px (image ~11.4); tile names raised to 12 px (image ~9.3). To fit two 12 px lines, the Monday blocks and therefore all three rows of the strip are taller: drop-off 30, window 38, pick-up 30 (image Tue–Fri 18.4 / 37.8 / 20.8, Mon 24.2 / 28.6 / 28.6). All five days now share the same three rows, so the axis reads across the week. Strip card 139 tall instead of 123; bottom margin 12.
- by STYLE: axis labels "8", "11", "12" (Label1, `--text-3`) in a 16.5 px gutter on the left of the strip: 8 = middle of the drop-off row (7:50–8:15), 11 = bottom of the window (11:15), 12 = middle of the pick-up row (11:45–12:10). For the gutter the Monday blocks start at x 34 instead of 24.2 (129.7 wide, the same as the other days).
- by STYLE: radii from the scale: band and strip 16 (image ~14), rows 12 (image ~10.5), strip blocks, window and tiles 8 (image ~5–6, so the tiles look a little rounder than on the image).
- by STYLE: "Mom" 12.2 px `--text-2`, request line `--text-2`, notes "· booked earlier" / "· after your primary care visit" `--text-2`.
- by STYLE: spacing: screen-edge margins kept as on the image (12–20 base px, not 24) so the composition does not change; card inner padding 15–16; gap between blocks as on the image (rows 3.2, band→title 9.4, rows→strip 8.3).
- by STYLE: touch targets: nothing on this screen can be pressed (the brief says no buttons), so no 48×48 targets are needed.
- by STYLE: no logos (Amazon/Alexa/Echo/insurers), no stars, ratings or doctor photos; "Alexa" only as plain text in the request line.

## Typos fixed
- None found. The image text matches the brief letter for letter ("OB-GYN", "Gastroenterology", "Daycare drop-off 7:50–8:15", "Daycare pick-up 11:45–12:10", "8:30–11:15 · while he's at daycare").

## Raster assets
- None. The image has no photos, avatars, crystals, stars or illustrations; the only picture element is the logo, which is inline SVG from logo-mark.svg. `assets-screen/` exists and is empty on purpose.

## Differences from the brief
- Brief block 6 (footer chain with SANDBOX tags) is not on the screen: removed by the task's screen edit (3), moved to screen 07.
- Brief: "Lab work · May need an order · after your primary care visit" — shown as the image and the task show it: specialty "Lab work" in the specialty column, status "May need an order · after your primary care visit".
- Brief: "Booked Tue Oct 20 ✓" — the check sits before the status, as on the image and in the task's edit (1).
- Brief asks the label "Daycare drop-off 7:50–8:15" in one piece; it is two lines (name, time) as on the image.

## Top 3 remaining differences
1. Whole content is 24 base px lower and the background is #14181E — required by STYLE; this keeps the official edgeF1 at ~0.27 and lumaMAE ~25. Shifted aux edgeF1 in the top region is 0.947.
2. Week strip proportions: rows 30/38/30 for every day (image Tue–Fri 18.4/37.8/20.8) and the Monday column narrower by the axis gutter — consequence of the 12 px minimum and the axis labels.
3. Font: Nunito instead of the image's font. Line widths within ±2 base px, but glyph shapes differ (the image's window label used a condensed face; the status strong part in the image is relatively narrower than Nunito 700); tiles are rounder (radius 8 vs ~5).

## Data screen (variable parts)
These strings come from data; the layout was stress-tested with longer values.
- Request line (quoted user utterance) — one line, nowrap; very long requests need a shorter text or a 2-line band (not designed here).
- Reply line (Alexa's answer: "Four booked. Lab work comes after Tuesday's visit.") — one line, nowrap.
- Title "Your checkup year" — fixed text.
- Subtitle: deductible/out-of-pocket state + "until <date>" (date "Dec 31" kept nowrap; "100%" nowrap).
- Source line (attribution) — fixed text from policy §13.
- Per row (5 rows): family member name ("Mom", 66 px column, nowrap); member colour bar (`--mom`, would be `--older`/`--youngest` for other members); specialty (wraps to 2 lines inside the fixed 28.8 px row, no ellipsis); status icon (booked = outline check, open = "?" in a ring); status strong word ("Booked" / "May need an order"); date ("Tue Oct 20", nowrap); note ("· booked earlier", "· after your primary care visit"; wraps, keep ≤ ~45 characters so it stays in 2 lines).
- Week strip: 5 day names ("Mon Oct 19" … "Fri Oct 23", nowrap); routine labels and times on Monday only ("Daycare drop-off" / "7:50–8:15", "Daycare pick-up" / "11:45–12:10"); window label ("8:30–11:15 ·" nowrap / "while he's at daycare"); visit tiles per day (specialty name; a single tile may wrap to 2 lines, two tiles in one day must each stay one line ≈ ≤ 18 characters); axis labels 8 / 11 / 12.
- Top bar: "demo data" (fixed).

Main CSS classes: `.topbar` `.brand` `.brand-mark` `.brand-name` `.demo` · `.convo` `.convo-ask` `.convo-reply` · `.plan-head` `.plan-title` `.plan-sub` `.plan-source` · `.plan-list` `.plan-row` `.who-bar` `.who` `.spec` `.st-icon.ok` `.st-icon.unk` `.status` `.note` · `.week` `.day-name` `.blk` `.routine` `.r-drop` `.r-win` `.r-pick` `.lbl` `.visit` `.visit.solo` `.sep` `.axis`.

# notes-screen — InNetwork 01 Family match (variant C)

Start: 2026-10-11 04:27:01Z · End: 2026-10-11 04:42Z (both read from `date -u`).
Final: `screen.html` (round v4; pixel-identical to v3 with the screen's data), `shots/screen-v4.png`, `shots/compare-screen-v4.png`, `shots/screen-light.png`.

## How the picture was measured
- Block edges came from brightness profiles in PIL, and text line boxes from ink scans (picture px × 0.4842 = base px). Example lanes: 213–394 / 409–590 / 605–774 px, which gives 87.6 / 87.6 / 81.8 base; doctor card x 1051–1563 px, which gives 247 base.
- Font sizes came from "ink width on the picture ÷ Nunito width at 1px" (playwright measurement). Examples: quote 11.98 → 12; reply 18.55 → 18.5/700; title 23.9 → 24/700; tile text 14.3–14.4; doctor names 13.9–14.3 → 14.3/700; times 13.9–14.9 → 14.5/700; pill 14.4/700.
- Two references for comparison:
  - The official one, `variant-C.png` (compare_to_image.py).
  - My own: the picture shifted down by 24 base (50 px). STYLE (Д) requires the shift, so this is the honest reference for alignment (`ref-shifted`, scratchpad).
- Line-box positions were compared numerically (ref vs render, base px) after every round.

## Rounds
| Round | What I saw | What I fixed | official edgeF1 / lumaMAE | vs shifted ref edgeF1 / lumaMAE |
|---|---|---|---|---|
| v1 | Composition matches. The band, title and doctor text sit 1–2 base too high. Lane 3 doctor text is 2–8 base too high: its rows are more widely spaced on the picture. The arrowhead is 1.8 base short. "Times fit" is 1.2 base too high. The pill text is lighter than on the picture. | Band and title moved down 1–1.5; doctor padding-top 6.4; network line margin 1.2; separate row gaps for lane 3 (+0.9/+2/+2.8); name 14 → 14.3; long arrow margin-right 6.3 → 4.5; routine margin 9; pill 14.4/700; tile text moved down 1.2; check made larger | 0.365 / 21.4 | 0.865 / 11.3 |
| v2 | Lines are within ≈1 base of the reference. The set-aside names are 1.2 base too high. The request quote is 0.6–1.2 base too high. | Set-aside card padding-top 6.1 → 7.1; band padding-top 8, reply margin 1.2 | 0.349 / 21.8 | 0.905 / 9.8 |
| v3 | Visual match in the zoom crops of all regions. No layout drift left, beyond the font difference. | Stress test with long data (long doctor and set-aside names, time 12:45 PM) found a problem: a 2-line name in lane 2 pushed the time out of the lane, where it was clipped (cardOverlaps 2) | 0.349 / 21.8 | 0.904 / 9.6 |
| v4 | Same render as v3, pixel for pixel (diff bbox = None) | Lanes and plates use min-height (the picture's heights) instead of a fixed height; the doctor card stretches with the grid. Long data now grows the lane into the bottom reserve (24 base) and is not clipped. Long-data stress: dom_check 0/0/0. | 0.349 / 21.8 | 0.904 / 9.6 |

Why the official metric is low: it is not a layout miss. Mandated changes cause it:
- the 24-base shift of all content under the new header;
- background #14181E instead of the purple;
- the badge row, the "Free morning" scale and the bottom logo were removed.

Against the shifted reference, contours match (edgeF1 0.904). lumaMAE 9.6 comes from the different background and card colours (tokens).

## Checks
- `dom_check.js` (final screen.html, 1280): `{"wrappedNumbers":0,"clipped":0,"cardOverlaps":0,"width":1280,"height":1080}`. The height is the 1280×1080 viewport of the check; the page itself is 1280×800 (render.js reports `{"w":1280,"h":800}`).
- Stress test with long data: 0 wrapped numbers, 0 clipped, 0 overlaps. The lanes grow by the extra line and the pill shifts into the bottom reserve. Two extra lines at once take the whole reserve.
- The tokens.css block is in `<style>` verbatim (string check: True). There are 0 raw hex/rgb values outside it. Own variables are in a second `:root` block; `--line-strong` = `color-mix(var(--text-1) 20%, var(--screen))`.
- There is one inline script, exactly the one given in the task. `<meta charset="UTF-8">` is the first element in `<head>`.
- Light theme `shots/screen-light.png` checked by eye: everything reads and nothing is missing. Person colours, check, rose reasons and logo switch to the light tokens.
- `assets-screen/` is empty. The picture has no raster decorations (photos, avatars, stars, illustrations). The checks and the mic are icons, done as inline SVG; the logo is inline SVG from logo-mark.svg.

## Differences from the picture by STYLE
- STYLE (А): body is 768×480 base px with `html{zoom:1.667}`, giving a 1280×800 render with overflow hidden. All sizes are in base px.
- STYLE (Б): screen background is var(--screen) #14181E instead of the warm purple of the picture.
  - Band and lanes: var(--card) with a 1px var(--hairline) border.
  - Doctor cards and set-aside cards: var(--card-inner).
  - The chip and pill borders use --line-strong (built from tokens).
- STYLE (Б): picture colours mapped to the nearest tokens:
  - coral → --mom, lilac → --older, teal → --youngest;
  - mint → --fits, pink reason → --rose;
  - grey request, network lines, chip text and the lilac "Times fit" → --text-2;
  - struck names → --text-3.
- STYLE (Д): new top row, 24 base high:
  - logo mark (inline SVG, height 12, fills var(--mom/--older/--youngest)) + "InNetwork" 14/700 at left 24;
  - "demo data" 10px var(--text-3) on the right, inset 24.
  - The logo and "demo data" at the bottom were removed.
  - All content moved down exactly 24 base. The freed bottom row keeps the picture's proportions; the gap under the pill is 23 base.
- STYLE (Е): the check is an outline check in var(--fits), with no circle and no fill (the picture has filled green circles). Set-aside names are struck through in var(--text-3); reasons are var(--rose) at Body3 12.
- STYLE (З): text below Body3 raised to 12:
  - network lines 10.3 → 12;
  - "Your note" chip 9.7 → 12;
  - set-aside names 11.6 → 12, reasons 9.2 → 12.
  - Effects: the lane 1 network line now wraps into 2 lines, breaking after "·"; the chip is wider (158 vs 134 base); the reasons wrap into 2 lines.
- STYLE (З): "Times fit your family routine" set to Body3 12 (it measured ~12.5 on the picture).
- STYLE (З): radii.
  - Cards (band, lanes): 16 (picture ≈ 11.5).
  - Nested elements (person plates, doctor card, set-aside cards): 12.
  - Note chip: 8. Pill: full radius.
- STYLE (З): spacing. The picture's composition values are kept where the scale would break it: side margins 12 (on the scale), gaps between lanes 7.3 (picture), plate inset 4.9 (picture).
- STYLE screen (1): each lane is an `<li>` in `<ol class="lanes">`.
  - Left: person plate (person colour as the label colour and frame, plan, specialty).
  - Right: doctor card with the time.
  - The dashed arrow stays a thin accent in the person's colour (1.4 base, dash 3.2/2.8, small arrowhead).
- STYLE screen (2): under the name there are 2 fields at most: the network line and the time. In the older child's lane: the network line, the note chip and the time.
- STYLE screen (3): the set-aside cards stay on the youngest's lane at the same x positions and widths, but each has a struck name and ONE short reason ("Doesn't see children under 3", "Not in his plan's network"). They are 60 base high instead of 67.
- STYLE screen (4): person-colour frames are 1.5 base.
- STYLE screen (5): the row of three source badges was removed.
- STYLE screen (6): "Times fit your family routine" kept as one Body3 line in var(--text-2) under the lanes, in the same place as on the picture.
- STYLE screen (7): the "Free morning" mini-scale under the mom's time was removed.
- STYLE (И): the screen has no pressable elements. The pill is a voice prompt (`role="note"`), 41.7 base high.
- STYLE (К): no logos, stars, ratings or photos. Doctor names are verbatim from the brief; "Alexa" is plain text.

## Typos
- None found on the picture. The texts were checked against brief.md word by word.

## Differences from brief.md (built as on the picture)
- Request quotes: the picture uses curly quotes “…”, the brief uses straight ones. Kept as on the picture. "He's", `"yes"` and `"great with kids"` keep straight quotes, as on the picture and in the brief.
- The picture has a "Free morning" scale that is not in the brief. STYLE removed it anyway.
- Brief items 8 (source badges) and the "demo data in a corner": the screen section of the task (STYLE (Д), screen (5)) overrides them, and the badges were removed.
- The set-aside reason for Dr. Tobias Wrenfield is shortened from the brief's full text to "Doesn't see children under 3", per STYLE screen (3).

## Top 3 remaining differences
1. Font proportions:
   - "Mom" is 5.4 base narrower than on the picture and "Older child" is 4.2 base wider. All names use one size (16.5/800) on purpose.
   - Nunito has a smaller cap height, so glyphs are about 10% shorter in height at the same line width.
2. Raising everything to Body3 12 changes some blocks:
   - In lane 1 the network line takes 2 lines, so the time sits 13 base lower than on the picture.
   - The set-aside reasons take 2 lines.
   - The note chip is 24 base wider.
3. Colour and shape follow the tokens, not the picture:
   - blue-grey background instead of purple;
   - grey chip text instead of pinkish;
   - outline check instead of a green circle;
   - card radius 16 instead of about 11.5.

## Screen data (variable parts)
| Part | Example | How the layout behaves with other lengths |
|---|---|---|
| Request quote | “Alexa, I need a gastroenterologist, … He's under two.” | one line, nowrap (may wrap if the band height is changed) |
| Alexa's reply | One doctor each, in their own plan. Book all three? | one line, nowrap |
| Title | Three people · three doctors · three plans | one line, nowrap |
| Person label (×3) | Mom / Older child / Youngest + "(under 2)" | in the plate, wraps naturally; "·" is glued to the previous word (nbsp); the plate grows (min-height 59) |
| Plan (×3) | Plan A / Plan B / Plan C | inside the plate text, "Plan&nbsp;A" does not break |
| Specialty (×3) | Gastroenterology / Allergy / Orthopedics | inside the plate text |
| Doctor name (×3) | Dr. Marisol Venterra / Dr. Ansel Quillfeather / Dr. Imogen Pellworth | wraps into 2 lines, never an ellipsis; the lane grows into the bottom reserve |
| Network / acceptance line (×3) | in Plan A's network · accepting new patients / … · sees this age | segments `.seg` are nowrap and break only between segments |
| Note (optional) | Your note: "great with kids" | one line, nowrap |
| Visit time (×3) | Thu Oct 22 · 9:15 AM / Wed Oct 21 · 2:30 PM / Mon Oct 19 · 1:30 PM | nowrap, never wraps |
| Set-aside doctor name (0–2) | Dr. Tobias Wrenfield / Dr. Caspian Ardley | struck through; wraps into 2 lines; the card grows |
| Set-aside reason (0–2) | Doesn't see children under 3 / Not in his plan's network | Body3, wraps naturally |
| Routine line | Times fit your family routine | one line, nowrap |
| Voice prompt | Say "yes" to book all three | nowrap; the pill takes the text width and stays centred |

Classes of the main blocks:
- `.app-bar`, `.brand`, `.brand-mark`, `.brand-name`, `.demo-tag`
- `.screen`, `.convo`, `.convo-request`, `.convo-reply`, `.screen-title`
- `.lanes`, `.lane` + `.lane--mom/--older/--youngest` (variable `--who`)
- `.person`, `.person-text`, `.person-name`, `.person-age`
- `.flow`, `.arrow` (`--long/--a/--b/--c`), `.arrow-shaft`, `.arrow-head`
- `.aside-card` (`--1/--2`), `.aside-name`, `.aside-reason`
- `.doctor`, `.check`, `.doctor-body`, `.doctor-name`, `.doctor-detail`, `.seg`, `.note-chip`, `.doctor-time`
- `.footer-row`, `.routine-note`, `.voice-pill`, `.mic`, `.voice-text`

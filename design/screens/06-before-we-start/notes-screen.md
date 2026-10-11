# notes-screen — InNetwork 06 Before we start (variant A)

Start: 2026-10-11T04:27:34Z · End: 2026-10-11T04:39Z (clock `date -u`).
Final: `screen.html` round v4 → `shots/screen-v4.png`, `shots/compare-screen-v4.png`, `shots/diff-screen-v4.png`; light theme `shots/screen-light.png`.

## Measurements (image 1586×992, ×0.4842 → base px)
Card 28.6–739.4 × 16.9–461.5 · rows x 44.1–724.4, heights 58.6 / 43.6 ×4, gaps 7.3 · disclaimer 55.2 tall, gap 9.7 above · Allow 104×38.3 pill · title "Before we start" width 236.3 → Nunito 800 32px · statements width → 17px (by the formula "image width ÷ font width"), stem 1.65 → weight 600 · disclaimer 15px/19 · Allow 14px/800 · "Not now" 13px/600 (stem 1.25). Colours were sampled with PIL; all of them were mapped to tokens (see STYLE).

## Rounds
- v1: line 1 of row 1 broke as "in-" / "network"; the disclaimer broke after "provider" (image: after "healthcare"); icons drew at ~80% of the 24 box; statement text looked lighter than on the image → see v2 (edgeF1 0.346 / lumaMAE 18.1).
- v2: "in-network" kept on one line (nowrap span); disclaimer right padding 56 so the break falls after "healthcare"; all five icons redrawn to fill the 24 grid, stroke 1.9; row 1 line height 21.5 + 3px top padding → line positions match the image to ±1px (edgeF1 0.359 / lumaMAE 18.0).
- v3: measured stems: image 1.65 vs mine 1.39 → statements weight 600 (width stays the same at 17px); "Not now" weight 600; family heads slightly larger (edgeF1 0.367 / lumaMAE 18.5).
- v4: disclaimer text sat 2.5px above its place inside the panel → padding-top 5 (now 13 / 9 from the top/bottom edges, as on the image). The metric dropped because the text moved away from its raw image position, which the global +7 header shift makes unreachable anyway; the proportion inside the panel is now correct (edgeF1 0.330 / lumaMAE 18.9).
- Metric note: the low edgeF1 comes from the global offset the requirements force on the layout (+7 base vertical for the header, −4 horizontal for the 24 margins). Shifting the v3 render back by (7, −12) px gives edgeF1 0.783 / lumaMAE 11.3, so the remaining internal mismatch is small; lumaMAE ~18 also includes the mandated navy instead of purple.

## STYLE deviations from the image (all deliberate)
- by STYLE (А): base canvas 768×480, `html{zoom:1.667}` → render 1280×800, overflow hidden, all sizes in base px.
- by STYLE (Б): screen background var(--screen) navy instead of the image's purple; the card is var(--card) with a 1px var(--hairline) border; rows and disclaimer are var(--card-inner) (the disclaimer also has a hairline border, as on the image); tokens.css blocks are copied verbatim; no raw hex/rgb outside them (checked by script).
- by STYLE (Д)/(4): logo and "demo data" removed from the bottom of the card; a 24px top bar holds the mark (inline SVG, 12px, fill var(--mom)/var(--older)/var(--youngest)), "InNetwork" 14/700 text-1, gap 8, and "demo data" Label1 text-3 on the right. The card starts directly under the bar (top 24, the image's card top was 16.9 → everything moves 7 base down); block proportions are kept exactly; the bottom margin shrinks from 19 to 12.
- by STYLE (З): screen margins 24 (image 28.6), rows 16 inside the card edge (image 15.5), row gap 8 (image 7.3), disclaimer gap 8 (image 9.7). Radii: card 16 (image ≈19), rows/disclaimer 12, buttons pill. Gaps between the title, disclaimer and buttons (10) and the button height (38) come from the image, because the scale would move those edges 2–3px.
- by STYLE (1): Allow is the only filled element, var(--accent) / var(--accent-text).
- by STYLE (2): "Not now" is an outline button the same size as Allow (104×38 base = 173×63 device px), border 1px var(--text-3). This made the two buttons wider than the image's pair, so Allow moved left from 543 to 509 base; Not now's right edge sits on the rows' right edge; gap 12.
- by STYLE (3): all icons are 24×24 on one grid, stroke 1.9, with the same centre (x 73.6 base). Colours: family var(--mom), calendar var(--older), note var(--youngest), lock var(--unknown), bubble var(--older). On the image the family icon is 35 wide and the bubble 29 wide; in the 24 grid they are 24 wide (smaller).
- by STYLE (5): the italic "r" in "No ratings." is a defect on the image and was not copied.
- by STYLE (И): buttons are ≥48×48 device px (173×63).
- Shadows: the image has faint dark shadows under the rows and the card. They were not copied (no shadow colour is in the tokens, and a flat surface matches the "like Alexa" decision).

## Typos fixed
None. The image text matches the brief word for word; the only defect is the italic "r" (see STYLE 5).

## Differences from brief.md
- brief: "Not now" is a text button and both buttons are "sized to content" → by the task (STYLE 2), both are fixed and equal size and "Not now" is outlined.
- brief: "demo data in a corner" → it is in the top bar on the right (STYLE Д).
- brief: Allow coral #FF8C6B / #17111C → the same values come from var(--accent)/var(--accent-text); in the light theme they become #B4462A / white, per the tokens.

## assets-screen/
Empty on purpose: the screen has no decorative raster elements (no photos, avatars or illustrations). The logo is an inline SVG and the icons are inline SVG.

## Checks
- `dom_check.js … 1280` → `{"wrappedNumbers":0,"wrappedEx":[],"clipped":0,"clippedEx":[],"cardOverlaps":0,"overlapEx":[],"width":1280,"height":1080}`. The height of 1080 is dom_check's viewport (html fills it); the render is 1280×800 (`render.js` dims `{"w":1280,"h":800}`).
- `<meta charset=UTF-8>` comes first; there is exactly one inline script (the theme switch); the tokens are verbatim; no raw colours outside the token blocks; the font is Nunito from fonts/ with font-display: block.
- Light theme `?theme=light` checked by eye: every text, icon, button and the mark is readable; row surfaces (#FAF9FB on a white card) are faint but visible; Allow is white on #B4462A.
- Text breaks match the image: row 1 breaks after "only to find", the disclaimer after "healthcare", rows 2–5 are single lines.

## Top 3 remaining differences
1. Global offset: content is 7 base lower (header) and the card is 4.6 base wider on each side (24 margins), so edges do not overlay the image one to one (edgeF1 0.33; aligned it would be ≈0.78).
2. Icons: the family and bubble icons are smaller than on the image (24 grid instead of 35/29 wide), and the note's curled corner is drawn as a folded cut corner.
3. Font: Nunito instead of the image's font. The title cap height is 22.6 vs 24.2 base; the disclaimer is weight 400 against a light (~300) weight on the image, because fonts/ has no 300; row 3 is 10 base wider than the image line.

## Data on the screen
Variable parts (they may come from data or translation later):
- `.brand-name` "InNetwork" · `.demo-data` "demo data"
- `.consent-title` "Before we start" (nowrap, single line)
- `.promise-text` ×5, the five statements (row 1 can hold 2 lines in 58px; rows 2–5 can hold 2 lines in 43px at 21.5 line height. A third line does not fit; shorten the text rather than the font). "in-network" sits in `.nobreak`.
- `.disclaimer` text (2 lines in a 56px panel; the 56px right padding sets the break. A longer text wraps into 2 lines with no ellipsis; a third line would need a taller panel).
- `.btn-allow` "Allow", `.btn-later` "Not now" (nowrap; 104px fits labels up to ~10 characters at these sizes).
- No names, dates, times, statuses or numbers on this screen.

Main block CSS classes: `.appbar`, `.brand`, `.brand-mark` (.m1/.m2/.m3), `.brand-name`, `.demo-data`, `.consent-card`, `.consent-title`, `.promises`, `.promise` (+ `.promise--tall`), `.promise-icon` (+ `.icon-family` / `.icon-calendar` / `.icon-note` / `.icon-lock` / `.icon-chat`), `.promise-text`, `.nobreak`, `.disclaimer`, `.actions`, `.btn`, `.btn-allow`, `.btn-later`.

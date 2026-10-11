# notes-screen — InNetwork 05 Set aside (variant A → screen.html)

Started 2026-10-11T04:27:26Z · finished 2026-10-11T04:39:54Z (UTC, from `date -u`).
Deliverables: `screen.html` (one file, tokens inline), `assets-screen/` (empty, see below), `shots/screen-v3.png` (final), `shots/compare-screen-v3.png`, `shots/diff-screen-v3.png`, `shots/screen-light.png`.
Extra diagnostics: `shots/_target-shifted.png` is variant-A re-laid to the required layout (24 px top bar, reply on 2 lines, badge removed, footer right-aligned). `shots/_cmp-shifted-v3.png` and `_diff-shifted-v3.png` compare against it. The official metric compares against the un-shifted picture, so it cannot get close to its targets on this screen.

## Measurements (python + PIL on variant-A.png, image px × 0.4842 = base px)
- Cards: x 21.5–377.7 and 390.7–746.6, y 121.5–252.3 (radius ≈ 12.6). Rows: x 22.3–746.1, y 289–316 / 319–347 / 350–378 / 381–410 (radius ≈ 9.7). Row separator at x 222, 16.5 tall. Card divider at y 221, inset 16.
- Font sizes from "picture width ÷ Nunito width at 100px": quote 13.2/400 · reply 16/800 · "Orthopedics" 17.5/800 + rest 16/700 · section titles 15.6/800 · card name 15.6/800 · specialty and check text 13/400 · slot 13.5/600 · struck names 13.3/400 · "Dr. Wendeline Hartsworth" 12/600 (on the picture it is narrower than the struck names) · reasons 11.6 → 12 · footer 8.8 → 12 · picture's "demo data" 8.7 → 10.
- Colours from the picture's text peaks, mapped to the nearest token: quote (184,180,199) → text-2 · specialty (205,200,212) → text-2 · check text (219,217,251) and age line (232,233,251) → text-1 · reasons (252,150,172) → rose · check icon (124,235,192) → fits · tab (99,250,222) → youngest · "?" (254,226,88) → unknown · divider and separator (≈64,55,70) → hairline · footer (175,171,186) → text-2.

## Rounds (what I saw → what I changed; official edgeF1/lumaMAE · against the shifted target)
- **v1:** layout laid out from the measurements. Per-line check: every block below the top bar sits 35.5 base lower, as planned; widths within ±3 base. Section titles and card names looked lighter than the picture, and the subtitle "for your youngest…" looked thinner. Card text sat about 4 base to the right. The middle dots in the date and age line had less space around them than on the picture. → 0.363 / 18.4 · 0.646 / 13.0
- **v2:** section titles and card names 800 at 15.6; topic subtitle 700 at 16; card and row padding 15 + 1 px border (16 from the edge); struck names 13.3; `.dot` margin 1.5 px around the middle dots. Card and row borders now land within 0.5 base of the shifted picture (157.2 / 287.4 / 324 / 351.6 …). → 0.365 / 18.5 · 0.650 / 13.3
- **v3:** check stroke 2 → 2.2 (closer to the picture's icon weight); zoomed crops look the same as v2 otherwise. After v3: quote allowed to wrap (spoken text is data); the render is pixel-identical to v3. → 0.365 / 18.5 · 0.658 / 12.7

## Checks
- `node dom_check.js file://…/screen.html 1280` → `{"wrappedNumbers":0,"wrappedEx":[],"clipped":0,"clippedEx":[],"cardOverlaps":0,"overlapEx":[],"width":1280,"height":1080}` (height 1080 = the script's own viewport; the page itself is 1280×800, overflow hidden, no scroll).
- render.js at 1280×800 → `{"w":1280,"h":800}`.
- Light theme (`?theme=light`) → `shots/screen-light.png`, looked at: everything readable, nothing missing; logo uses the light colours (#B4462A / #6A4FCF / #0F7F76 via the tokens), rows and cards show by their hairline borders.
- Outside the two token blocks: 0 raw hex/rgb; 1 `<script>` (the allowed theme line); `<meta charset="UTF-8">` is the first element in `<head>`. The token blocks match tokens.css exactly (checked by script).
- Stress test (temporary copy with long names and a long reason): names wrap to 2 lines with no ellipsis, the row grows, the footer still fits, and dom_check is clean.

## Typos fixed
None found on the picture. The picture mixes straight and curly apostrophes ("Plan C's"); I used ’ throughout.

## Differences from brief.md
- Rows 1–2: the brief and the picture have "… · confirmed by the office at a past booking · demo data". Per STYLE (2) I kept only "Doesn't see children under 3".
- The brief and the picture have the badge "network: recorded sample". Per STYLE (3) it is removed; "demo data" now sits only in the top bar.
- The brief's reply is one sentence on one line. Per STYLE (1) it is split into two lines.

## Differences made under STYLE (по STYLE)
- по STYLE: canvas 768×480 base px with `html{zoom:1.667}` → 1280×800; all sizes in base px.
- по STYLE: background `var(--screen)` #14181E instead of the picture's warm purple. Cards are `var(--card)` with a 1px `var(--hairline)` border, not the picture's lighter filled tiles. Set-aside rows get the same treatment (on the picture they share the cards' fill).
- по STYLE: radii — card 16 (picture ≈ 12.6), rows 12 (picture ≈ 9.7), tab is a pill.
- по STYLE: screen margins 24 (picture: cards at 21.5, text at 26.6). Gap between cards 12 (picture 13), card padding 16.
- по STYLE: new top bar, 24 tall, left 24. Three-circle mark, 12 tall, as inline SVG with fill var(--mom)/var(--older)/var(--youngest). "InNetwork" at 14/700 text-1. "demo data" on the right at 10 text-3. The picture's logo and "demo data" at the bottom are removed.
- по STYLE: all content moved down. The second reply line adds height, so gaps were tightened by about 8 base: quote under the top bar, reply line-height 19, reply→topic 12. The badge and logo row that were removed absorb the rest. The footer moved to the bottom-right edge (right margin 24), now that the "demo data" next to it is gone.
- по STYLE: the reply is two lines, "I checked six nearby." / "Two don't see children under three, one isn't in his plan. These two fit.", same size as the picture (16/800).
- по STYLE: filled green check circles → outline check only, `var(--fits)`, no circle or fill.
- по STYLE: filled yellow "?" disc → yellow "?" inside a thin outline circle `var(--unknown)`, no fill.
- по STYLE: struck names use `var(--text-3)` with the strike line in text-3. Reasons are `var(--rose)` at 12 (Body3); the picture has them at ≈ 11.6.
- по STYLE: minimum size — footer 8.8 → 12 (Body3), reasons 11.6 → 12, "demo data" 10 (Label1). No 8 px text anywhere.
- по STYLE: check text and the age line use text-1, the nearest token to the picture's pale lavender.
- по STYLE: nothing on the screen is tappable (no buttons, by the brief), so the 48 px touch rule has nothing to apply to. The cards are 354×131 base anyway.
- Raster cut-outs: the picture has no photos, avatars or illustrations. The only raster-like element was the logo, which is replaced by the real inline SVG. So `assets-screen/` is empty and there are no `<img>` elements.

## Top 3 remaining differences
1. Everything below the top bar is 35.5 base (≈ 59 px at 1280) lower than on the picture, because of the required 24 px top bar and the second reply line. This holds the official edgeF1 at ≈ 0.37. Against the shifted target, lines and borders match to within about 0.5–3 base.
2. Surfaces and background: outlined cards and rows on #14181E instead of filled lilac tiles on warm purple. This, plus the shift, is most of lumaMAE 18.5.
3. Icons and type: outline check and "?" instead of filled discs; footer at 12 instead of ≈ 9. Nunito vs the picture's font: line widths are within ±4 base, Nunito's cap height is lower, and the picture's lavender text tint is gone.

## What did not work
The official targets (edgeF1 ≥ 0.90, lumaMAE ≤ 2.0) cannot be reached on this screen, because the required top bar, two-line reply and token surfaces all differ from the picture by design. Positions were tuned against the shifted target instead.

## Данные экрана (variable parts → element / class; how they behave with other lengths)
- Spoken request: "“Alexa, find an orthopedist for my youngest. He's under two.”" → `.convo__ask` (wraps if longer).
- Alexa reply, line 1 and line 2: "I checked six nearby." / "Two don't see children under three, one isn't in his plan. These two fit." → `.convo__reply > span` (one block per line; wraps). The counts (six, two, one) are in the text.
- Topic: specialty "Orthopedics" (`.topic__title b`), member "for your youngest (under 2)", plan "Plan C" → `.topic__title` (wraps; tab `.topic__tab` stretches). Tab colour = family member (var(--youngest)).
- Doctor cards (×N, grid of 2): name "Dr. Imogen Pellworth" / "Dr. Corwin Pembrook" → `.doc-card__name` (wraps to 2 lines, no ellipsis; the card grows). Specialty "Pediatric orthopedics" / "Orthopedics" → `.doc-card__spec`. Status lines "in Plan C's network" (plan name varies), "sees this age" → `.check-line` (nowrap, short labels). Slot date "Mon Oct 19" / "Tue Oct 20" and time "1:30 PM" / "2:00 PM" → `.doc-card__slot` (nowrap, number).
- Set-aside rows (×N): name → `.aside-row__name` (wraps inside a fixed 174 px name column; the row grows from min 28). Status: struck → `.aside-row--struck`; unknown → `.aside-row--unknown` with `.aside-row__q`. Reason "Doesn't see children under 3" / "Not in his plan's network" / "Age not listed · we'll ask the office when booking" → `.aside-row__reason` (wraps).
- Footer "Age used for this search only · not saved" → `.foot-note`. Label "demo data" → `.demo-tag`.
- Height budget: one wrapped row name adds about 8 base and still fits. A wrapped card name adds 20 base, and so does each extra row or card; the footer then runs past 480 (body overflow hidden). Long data needs fewer rows or a scrolling list.
- Main block classes: `.topbar` `.brand` `.brand__mark` `.brand__name` `.demo-tag` · `.convo` `.convo__ask` `.convo__reply` · `.topic` `.topic__tab` `.topic__title` · `.section-title` (`--fits`, `--aside`) · `.fits-grid` `.doc-card` `.doc-card__name` `.doc-card__spec` `.doc-card__checks` `.check-line` `.doc-card__rule` `.doc-card__slot` · `.aside-list` `.aside-row` (`--struck`, `--unknown`) `.aside-row__who` `.aside-row__q` `.aside-row__name` `.aside-row__sep` `.aside-row__reason` · `.dot` · `.foot-note`.

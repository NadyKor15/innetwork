# notes-screen — InNetwork 04 Booked (variant-B.png → screen.html)

Started 2026-10-11 04:27:23Z (`date -u`). Finished: see the last line.

## Rounds
- **v1:** first build by measured boundaries: brightness profiles for cards, rows, week tiles and dividers; font size from cap height and text width; image × 0.4842 = base px; content shifted down by the 24-px header. Saw: title 3.4 px narrower, check mark 2.3 px to the right, subtitle 1.4 px to the left, rows 1 and 3 about 2 px narrower than the image. Overall layout and block proportions matched. → edgeF1 0.277 / lumaMAE 23.8 (with the 24-px shift compensated: 0.870 / 11.1)
- **v2:** title letter-spacing 0.5 → 0.7, check margin 17.5 → 11.8, subtitle padding +1.4, rows letter-spacing 0.1 → 0.13. Title, check and subtitle now within ≤0.5 base px of the image, rows within ≤2 px (font difference). → edgeF1 0.280 / lumaMAE 23.8 (shift-compensated 0.868 / 11.4)
- **v3:** week overlay: image chips are about 18 px tall (mine were 17), and the day headers sat 1 px high. Fix: chip height 18, headers 0.6 px lower (tiles unchanged, divider adjusted). → edgeF1 0.280 / lumaMAE 23.8 (shift-compensated 0.866 / 11.4)

The raw metric is low on purpose and won't go higher: the header moves all content down by 24 base px (40 px at 1280), and the background is #14181E, not the purple from the image. To check alignment I ran a second comparison with the render cropped by 40 px. Element bounding boxes were compared against the image in base px with a script.

## Checks
- dom_check (final): `{"wrappedNumbers":0,"wrappedEx":[],"clipped":0,"clippedEx":[],"cardOverlaps":0,"overlapEx":[],"width":1280,"height":1080}`. height 1080 = dom_check's own viewport (html has overflow hidden). At 1280×800 render.js gives exactly `{"w":1280,"h":800}`, one page with no scrolling.
- My own fit script: every text has 1 line (the Monday routine labels have 3 lines by design), and nothing extends past its plate, chip or row. The tightest fit is "11:45–12:10": 3.3 base px left at the right edge of the tile.
- Tokens: tokens.css is copied in verbatim. Outside those blocks there is not a single raw hex/rgb (checked with a regex). My own variables are a second `:root` block built with `color-mix()` from the tokens.
- There is exactly one inline script (theme=light). `<meta charset="UTF-8">` is the first tag in `<head>` (doctype stays first, otherwise quirks mode).
- Light theme `shots/screen-light.png` checked by eye: all text is readable, the chips are white on dark coral, the window is a light coral wash, the logo uses colours from logo-mark-light, the check is dark green. Nothing is missing.

## By STYLE (differences from the image)
- By STYLE (А): canvas is body 768×480 + `html{zoom:1.667}` → 1280×800, overflow hidden. All sizes are in base px.
- By STYLE (Б): screen background is var(--screen) #14181E, not the purple from the image. Cards are var(--card) with a 1px var(--hairline) border, rows are var(--card-inner). Coral → var(--mom), mint → var(--fits). The routine tiles are gray via `color-mix(var(--text-1) 10%, var(--card-inner))`. The dimmed dot of the 4th row is `color-mix(var(--mom) 40%, var(--card-inner))`. The window is var(--mom-window).
- By STYLE (Д): the header row is 24 px tall: the inline-SVG mark (3 circles, height 12, fill var(--mom)/var(--older)/var(--youngest)) + "InNetwork" 14/700 on the left at x=24, and "demo data" 10px var(--text-3) on the right. The logo and "demo data" at the bottom were removed. All content moved down 24. The freed bottom row absorbed the shift, so block sizes are unchanged (bottom margin 28).
- By STYLE (Е): the title check is a stroke outline only, var(--fits), no circle and no fill. The image already had no circle.
- By STYLE (Ж): the time chips are var(--mom) with var(--on-accent) text (dark; in the light theme the token gives white on dark coral).
- By STYLE (З) type sizes: title Display2 40/800, subtitle Display5 24/700, rows Body2 14/600, the "booked earlier" row Body3 12, day headers raised from ≈10.3 to Body3 12. Two cases went to Label1 10 instead of Body3:
  - time chips: these are badges;
  - Monday routine labels: they are axis labels for the rows of the week grid ("labelled once (Monday)"). Body3 does not fit physically: "11:45–12:10" at 12px = 69 base px with a tile width of 69. At 10px "Daycare drop-off" still doesn't fit on one line, so it breaks into 3 lines (Daycare / drop-off / time). The routine tiles became taller (38 instead of 33–34). That was paid for by a lower window row (45 instead of 49.6) and a tighter header and bottom padding inside the card, so the card height didn't change.
- By STYLE (З) radii: card 16, rows and week tiles 12, chips 8. The image has ≈8 / 5 / 3, so the corners are rounder and the chips look almost like pills. Spacing: screen margins and gaps between blocks are kept as in the image (≈11 / 6 / 10.4 / 7 base px). Bringing them to 24/12 would break the composition, which the rule allows.
- By STYLE (И): there are no tappable elements on the screen (cancel is by voice), so touch targets don't apply.
- By STYLE edit (1): both bands use Headline1 20/600 (the image has ≈21.3/700), so they don't compete with the title. The band height and the icon position are as in the image.
- By STYLE edit (2): the footer chain "directory → booking SANDBOX → calendar SANDBOX → app + email" was removed (it moved to screen 07).
- By STYLE edit (3): the week time tiles are coral with dark text.
- By STYLE edit (4): "Alexa app" is plain text, and "Alexa" has no logo.
- Raster decoration: none on the image (no photos, avatars or illustrations). The icons (document, microphone), the check and the logo are inline SVG. The `assets-screen/` folder was created and is empty.

## Typos fixed
- "directỏry" (diacritic) in the footer was not carried over: the whole footer was removed by STYLE edit (2).
- No other typos. "OB–GYN" (dash on the image) → "OB-GYN" with a hyphen, as in the brief.

## Differences from the brief
- Brief block 7 (footer chain with SANDBOX) was removed by STYLE edit (2), which takes priority.
- The brief puts "demo data" "in a corner"; it now sits in the header on the right (STYLE Д).
- Straight quotes in `Say "cancel" anytime` and the apostrophe in "he's" are kept as on the image and in the brief.

## Top 3 remaining differences
1. All content sits 24 base px (40 px) lower than on the image, and the background is blue-black instead of purple. Both are mandated by STYLE, so the raw metric doesn't climb above ≈0.28 / 23.8.
2. Inside the week card: the day headers are larger (12 instead of ≈10.3), the Monday labels have 3 lines instead of 2, the routine tiles are taller by ≈4–5 px and the window row is shorter by ≈4.6 px. These come from the type minimums.
3. Rounder corners (16/12/8 instead of ≈8/5/3) and smaller band text (20/600 instead of ≈21.3/700). Rows are ±2 px wide because the font differs.

## Screen data (strings that will be filled from data)
- Title: visit count ("3 visits").
- Subtitle: window start and end ("8:30", "11") and the reason ("while he's at daycare").
- List rows, each one: date ("Tue Oct 20"), time ("9:00 AM"), specialty ("Primary care" / "OB-GYN" / "Dermatology"), plus status ("booked earlier") for an earlier booking. Date and time are `nowrap`. A long specialty wraps to a 2nd line inside the 35.3-px row (line-height 17); there is no ellipsis.
- Week: 5 day headers (weekday + date "Oct 19"…"Oct 23"); routine labels with times ("Daycare drop-off" 7:50–8:15, "Daycare pick-up" 11:45–12:10), times `nowrap`, the name may wrap; visit chips (time, vertical position `style="top:…"` from the time within the window 8:30–11:00, two chips in one day are stacked).
- Bands: delivery channels ("your Alexa app and email"), the voice command ("cancel").
- Header: "demo data" (shown only in demo mode).
- CSS classes of the main blocks: `.topbar` `.brand` `.logo-mark` `.brand-name` `.demo` · `.hero` `.title` `.title-text` `.title-check` `.subtitle` · `.cards` `.card` · `.visits` `.visit-list` `.visit` `.visit--earlier` `.dot` `.visit-text` `.visit-note` · `.week` `.week-grid` `.day` `.day-head` `.slot` `.slot--routine` `.slot--window` `.routine-label` `.time` `.chip` · `.band` `.band--sent` `.band--cancel` `.band-icon` `.band-text` · helper `.nw`.

Finished 2026-10-11 04:39:45Z (`date -u`).

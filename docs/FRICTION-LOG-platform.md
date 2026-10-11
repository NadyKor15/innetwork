# Friction log — Alexa+ platform, MCP Apps, design guide (merged into FRICTION-LOG.md)

Format per entry: task · steps · expected vs actual · severity · workaround · suggestion. Dates UTC.

### A1. No way to run the add-on on Alexa+ outside the partner preview
- **Task:** show the MCP add-on working inside Alexa+.
- **Steps:** read the add-on docs and the hackathon forum; looked for a public toolkit or web simulator.
- **Expected vs actual:** expected a sandbox or simulator for builders; actual: "the Alexa+ Add-on toolkit and web simulator are in preview with select partners" (forum 45397).
- **Severity:** High (for any Alexa+ track entry).
- **Workaround:** our own host: official MCP client + MCP Apps bridge + a sandbox proxy on a second origin + a 1280×800 device frame (`host/`); a classic skill for one scene on a real Echo Show (`skill/`).
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

# Product feedback (the five Devpost feedback questions)

Every statement is from my own build; versions are pinned in `package.json`.

## 1. Which developer tools, APIs, and SDKs did you use and for what?
- **MCP TypeScript SDK v2** — `@modelcontextprotocol/server` 2.3.1 (the add-on: 9 tools), `@modelcontextprotocol/node` 2.1.1 (Streamable HTTP, strict 2025-11-25 sessions), `@modelcontextprotocol/client` 2.3.1 (the Echo Show simulator, verify). One endpoint serves 2025-11-25 and 2026-07-28 through the SDK's `isLegacyRequest` + `createMcpHandler`.
- **MCP Apps** — `@modelcontextprotocol/ext-apps` 2.0.3: `registerAppTool` / `registerAppResource` on the server (six `ui://innetwork/*.html` screens), `App` in the screens, `AppBridge` + a sandbox proxy on a second origin in the host.
- **Alexa Skills Kit** — ASK SDK for Node.js (`ask-sdk-core`, `ask-sdk-express-adapter`) and APL, for a classic Alexa skill that is an MCP client of the same server for the checkup-year scene; the endpoint runs the SDK's request signature and timestamp verifiers. Built and tested against the server (5 tests); run on a real Echo Show 8 on Oct 20, 2026.
- **Alexa+ add-on documentation** — design guide (Visual Foundations, Layout and Rendering, Brand Expression, Components and Patterns, Display modes, Accessibility), policy requirements (§3, §4, §13, §15), Local Booking SPI and integration-approach pages: screen rules (768×480 base ×1.667, type scale, light/dark), consent, booking read-back and written confirmation, health disclaimers.
- **MCP Inspector CLI** 2.8.0 — independent check of both protocol eras (`--strict`, `--app-info`, a tool call).
- **Public insurer directories (FHIR Plan-Net)** — Florida Blue (Plan A's network step, live), Molina (Plan C: Florida Medicaid Managed Medical Assistance, network 15), and UnitedHealthcare/Optum, Cigna, Humana, Centene for the audit (`npm run audit:directories`, run of 2026-10-13: all six directories, 10,075 records).
- **NPPES NPI Registry API** — joining records across insurers by NPI, the practice-location check, and the fictional-name guard (every demo name must match nobody).
- **CMS QHP machine-readable provider files** (and the CMS Machine-readable URL PUF) — Plan B (Oscar Florida, Silver Classic Standard), read by streaming from files up to 1.5 GB.
- Playwright 1.63 (headless verify of every screen and beat), esbuild 0.28 (screen bundles), Node 26 (TypeScript type stripping, `node --test`).

## 2. What worked well?
- **MCP SDK v2 dual era**: serving 2025-11-25 (stateful sessions) and 2026-07-28 (per request) from one URL took one routing call; the official client negotiates either (`versionNegotiation: { mode: "auto" }`). Both eras passed Inspector `--strict`.
- **Strict input schemas** (zod `.strict()`) gave me refusals for free: a `symptoms` field or a specialty outside the closed list is rejected by the SDK before my code runs.
- **MCP Apps**: one resource per screen with `_meta.ui.resourceUri` on the tool, CSP declared in `_meta.ui.csp` — the host can render and sandbox the screen without knowing anything about InNetwork.
- **Alexa+ design guide**: concrete numbers (base canvas, scale factor, type scale, spacing, radii, 48 px touch targets, contrast) made it possible to check screens mechanically.
- **Directories**: six insurers answer anonymous FHIR reads with no key or registration; Plan-Net's shape is the same across them, so one reader covers six; Molina's CapabilityStatement lists its search parameters (including `network`); marketplace files carry plan ids and an accepting-new-patients flag; NPPES never failed in my runs (0 errors).

## 3. What needs work?
- **Alexa+ booking for health care**: the documented booking path (Local Booking SPI) names salons, spas and fitness; there is no clinic/practitioner profile and no place for "plan network" or "patient age group" (feature request FR1).
- **Policy clarity for a parent-directed health navigator** (§4 child safety vs §13 health vs §3 privacy): I could not tell whether receiving a child's age band for one search is acceptable; I minimized and simulated (FR3).
- **`hostContext.theme`**: the guide asks for native light and dark, but the value format of `theme` and any host color/type tokens are not documented; I guessed `"dark" | "light"` (FR4).
- **No public Alexa+ simulator**: every builder outside the preview re-implements a host (MCP client, MCP Apps bridge, device frame) (FR5).
- **Directories** (friction log F1–F15, each with the command and the number): no record of 10,075 states a patient age and Plan-Net has no structured field for it (F12); Florida Blue hides `/metadata`, answers an unknown parameter with HTTP 200 (F1, F2), and 5 of 14 plans point to a network no practitioner uses (F3); specialty is free text, gastroenterologists are filed as internal medicine (F4); Molina has an undocumented daily quota that stopped every request until midnight UTC (F6b) and its Medicaid plan record has an empty network (F7); marketplace plans have no API and one file is up to 1.5 GB (F9); Aetna and Elevance need registration, UnitedHealthcare's marketplace index answers 403 (F11); 4 of 30 in-network orthopedists listed at Orlando addresses report practicing in another state (F14).

## 4. How was your onboarding experience (zero to hello world)?
- MCP SDK v2: with a pattern from an earlier build, the server answered over Streamable HTTP within the first hour; the dual-era routing is two exported functions (`isLegacyRequest`, `createMcpHandler`) — easy once you know them, not obvious from a guide page.
- MCP Apps: the server side is two calls; the host side (AppBridge + sandbox proxy + teardown order) needs the examples in the package — the spec's ordering rules (no messages before `initialized`, `ui/resource-teardown` before removing a view) matter in practice.
- Alexa+ docs: reading, not running — no access to the add-on toolkit outside the preview, so "hello world" on Alexa+ itself was not possible; I simulated the host.
- Classic Alexa skill (ASK SDK + APL): built and tested locally against my server, then run on a real Echo Show 8 on Oct 20, 2026. Device onboarding took two fixes: with Alexa+ on the device, "Alexa, open In Network" did not reach the development skill, "Alexa, open the In Network skill" did (friction log A7); and a lone APL parameter named `payload` left the card empty (A8).
- **Directories**: Molina — minutes (CapabilityStatement); Florida Blue — about ten minutes, by reading the parameter list out of an error message (no `/metadata`); marketplace files — minutes from the CMS PUF list to the right index and provider files, then 11–30 s to stream each file of about 233,000 providers; NPPES — immediate.

## 5. Would you build with these devices and services again?
Yes. The MCP route is the right shape for Alexa+: the add-on is a normal HTTPS service with typed tools and its own screens, testable without a device. I would build again as soon as health-care booking and the add-on toolkit are open beyond the preview — the hard parts of InNetwork (plan networks, age policies, a family's routine) sit in my server, so they would carry over unchanged. I would build on FHIR Plan-Net directories again too — the same reader works across insurers — and I hope for a structured age field and working `/metadata`.

## AWS services
None. This project does not enter the AWS Builder mini challenge, and the code uses no AWS services.

# Product feedback (the five Devpost feedback questions)

Draft, 2026-10-11. Every statement is from our own build; versions are pinned in `package.json`.

## 1. Which developer tools, APIs, and SDKs did you use and for what?
- **MCP TypeScript SDK v2** — `@modelcontextprotocol/server` 2.3.1 (the add-on: 9 tools), `@modelcontextprotocol/node` 2.1.1 (Streamable HTTP, strict 2025-11-25 sessions), `@modelcontextprotocol/client` 2.3.1 (the Echo Show simulator, verify). One endpoint serves 2025-11-25 and 2026-07-28 through the SDK's `isLegacyRequest` + `createMcpHandler`.
- **MCP Apps** — `@modelcontextprotocol/ext-apps` 2.0.3: `registerAppTool` / `registerAppResource` on the server (six `ui://innetwork/*.html` screens), `App` in the screens, `AppBridge` + a sandbox proxy on a second origin in the host.
- **Alexa+ add-on documentation** — design guide (Visual Foundations, Layout and Rendering, Brand Expression, Components and Patterns, Display modes, Accessibility), policy requirements (§3, §4, §13, §15), Local Booking SPI and integration-approach pages: screen rules (768×480 base ×1.667, type scale, light/dark), consent, booking read-back and written confirmation, health disclaimers.
- **MCP Inspector CLI** 2.8.0 — independent check of both protocol eras (`--strict`, `--app-info`, a tool call).
- **Public insurer directories (FHIR Plan-Net)**, **NPPES NPI Registry API**, **CMS QHP machine-readable provider files** — ⏳ (directory lane: what each was used for).
- Playwright 1.63 (headless verify of every screen and beat), esbuild 0.28 (screen bundles), Node 26 (TypeScript type stripping, `node --test`).

## 2. What worked well?
- **MCP SDK v2 dual era**: serving 2025-11-25 (stateful sessions) and 2026-07-28 (per request) from one URL took one routing call; the official client negotiates either (`versionNegotiation: { mode: "auto" }`). Both eras passed Inspector `--strict` on the first try.
- **Strict input schemas** (zod `.strict()`) gave us refusals for free: a `symptoms` field or a specialty outside the closed list is rejected by the SDK before our code runs.
- **MCP Apps**: one resource per screen with `_meta.ui.resourceUri` on the tool, CSP declared in `_meta.ui.csp` — the host can render and sandbox the screen without knowing anything about InNetwork.
- **Alexa+ design guide**: concrete numbers (base canvas, scale factor, type scale, spacing, radii, 48 px touch targets, contrast) made it possible to check screens mechanically.
- ⏳ directories.

## 3. What needs work?
- **Alexa+ booking for health care**: the documented booking path (Local Booking SPI) names salons, spas and fitness; there is no clinic/practitioner profile and no place for "plan network" or "patient age group" (feature request FR1).
- **Policy clarity for a parent-directed health navigator** (§4 child safety vs §13 health vs §3 privacy): we could not tell whether receiving a child's age band for one search is acceptable; we minimized and simulated (FR3).
- **`hostContext.theme`**: the guide asks for native light and dark, but the value format of `theme` and any host color/type tokens are not documented; we guessed `"dark" | "light"` (FR4).
- **No public Alexa+ simulator**: every builder outside the preview re-implements a host (MCP client, MCP Apps bridge, device frame) (FR5).
- ⏳ directories (registration-gated APIs, timeouts, no age field, file-only marketplace directories).

## 4. How was your onboarding experience (zero to hello world)?
- MCP SDK v2: with a pattern from an earlier build, the server answered over Streamable HTTP within the first hour; the dual-era routing is two exported functions (`isLegacyRequest`, `createMcpHandler`) — easy once you know them, not obvious from a guide page.
- MCP Apps: the server side is two calls; the host side (AppBridge + sandbox proxy + teardown order) needs the examples in the package — the spec's ordering rules (no messages before `initialized`, `ui/resource-teardown` before removing a view) matter in practice.
- Alexa+ docs: reading, not running — no access to the add-on toolkit outside the preview, so "hello world" on Alexa+ itself was not possible; we simulated the host.
- ⏳ directories.

## 5. Would you build with these devices and services again?
Yes. The MCP route is the right shape for Alexa+: the add-on is a normal HTTPS service with typed tools and its own screens, testable without a device. We would build again as soon as health-care booking and the add-on toolkit are open beyond the preview — the hard parts of InNetwork (plan networks, age policies, a family's routine) sit in our server, so they would carry over unchanged.

## AWS services
None (we did not enter the AWS Builder mini challenge with this draft; ⏳ decision pending).

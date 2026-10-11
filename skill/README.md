# InNetwork on a real Echo Show (classic Alexa skill, development mode)

Narrow on purpose (SPEC §6.4): the adult's own checkup year only — "Alexa, open in network" / "what's next on my checkup plan?" → the server's `checkup_year` line, and the "Your checkup year" card as APL on a screen. No children's searches on the device, no ages, never published or certified. The skill is a thin MCP client of the same InNetwork server the simulator uses (`skill/src/mcp.ts`, 6 s deadline inside Alexa's 8 s).

| File | What |
|---|---|
| `src/handler.ts` | ASK SDK handlers: Launch, CheckupStatusIntent, AllowIntent (consent), Help, Stop/Cancel, Fallback |
| `src/apl.ts` | APL document from the tool's card (same colours as the screens; device font) |
| `src/endpoint.ts` | self-hosted HTTPS endpoint; every request passes the ASK SDK's signature and timestamp verifiers first |
| `interaction-model/en-US.json`, `skill-package/skill.json` | console model and manifest (development) |
| `test/skill.test.ts` | `npm run skill:test`: the skill against a live server (screen / no screen / consent / server down / unsigned request rejected) |

## Putting it on the device (human steps — not done by any script)
1. Amazon developer console, the account the Echo Show is registered to: create a custom skill "In Network", paste `interaction-model/en-US.json`, enable APL.
2. Run the server and `SKILL_ID=… SKILL_HOUSEHOLD=… npm run skill:start` behind a TLS endpoint you control; set it as the HTTPS endpoint.
3. Test tab → Development → on the Echo Show: "Alexa, open in network".
No AWS account, Lambda or payment is needed for this path.

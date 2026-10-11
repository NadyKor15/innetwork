// HTTPS endpoint for the classic skill (self-hosted; put it behind a TLS terminator for the Alexa console).
// Every request is checked with the ASK SDK's own verifiers before the skill sees it: the request signature
// (Signature-256 header + the Amazon certificate chain) and the timestamp (150 s tolerance). A request that fails
// either check gets 400 and is never handled. The skill id is enforced by the skill builder (SKILL_ID).
//   SKILL_ID=amzn1.ask.skill.... INNETWORK_MCP_URL=http://127.0.0.1:8797/mcp SKILL_HOUSEHOLD=<household> node skill/src/endpoint.ts
import { createServer, type IncomingMessage } from "node:http";
import { SkillRequestSignatureVerifier, TimestampVerifier } from "ask-sdk-express-adapter";
import { buildSkill } from "./handler.ts";
import { connectInNetwork } from "./mcp.ts";

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > 256_000) throw new Error("body too large"); chunks.push(c as Buffer); }
  return Buffer.concat(chunks).toString("utf8");
}

export function startSkillEndpoint(opts: { port: number; skillId?: string; mcpUrl: string; household: string; verify?: boolean }) {
  const skill = buildSkill({ innetwork: connectInNetwork({ url: opts.mcpUrl, token: `innet-sandbox-${opts.household}` }), skillId: opts.skillId });
  const verifiers = [new SkillRequestSignatureVerifier(), new TimestampVerifier()];
  const http = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}'); return; }
    if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
    try {
      const raw = await body(req);
      if (opts.verify !== false) {
        for (const v of verifiers) await v.verify(raw, req.headers as Record<string, string>);
      }
      const out = await skill.invoke(JSON.parse(raw));
      res.writeHead(200, { "Content-Type": "application/json;charset=UTF-8" });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("request rejected");
      console.error("[skill endpoint] rejected:", String((e as Error).message ?? e).slice(0, 200));
    }
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => http.listen(opts.port, "127.0.0.1", () => {
    const a = http.address() as { port: number };
    resolve({ url: `http://127.0.0.1:${a.port}/`, close: () => new Promise((r) => { http.closeAllConnections(); http.close(() => r()); }) });
  }));
}

if (import.meta.main) {
  const ep = await startSkillEndpoint({
    port: Number(process.env.SKILL_PORT ?? 8798), skillId: process.env.SKILL_ID, mcpUrl: process.env.INNETWORK_MCP_URL ?? "http://127.0.0.1:8797/mcp",
    household: process.env.SKILL_HOUSEHOLD ?? "echo-show-demo",
  });
  console.log(`InNetwork skill endpoint ${ep.url} (signature + timestamp verified)`);
}

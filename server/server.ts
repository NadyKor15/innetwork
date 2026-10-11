// InNetwork MCP server over Streamable HTTP.
//   POST/GET/DELETE /mcp   MCP. 2025-11-25 (strict, stateful Mcp-Session-Id) and 2026-07-28 (per-request) on the same
//                          endpoint; the era is chosen by the SDK's own isLegacyRequest().
//   GET /healthz           liveness + protocol list + directory mode
//   GET /devinfo           developer view data: plans with their source (insurer/type - never on customer cards),
//                          latest live probes, latest verify and audit results from disk
//   GET /assets/fonts/*    Nunito (SIL OFL 1.1), declared in each view's _meta.ui.csp
// Account linking is simulated: the host sends "Authorization: Bearer innet-sandbox-<userId>"; the user id keys the
// per-household state file. A real deployment would use Alexa+ account linking (OAuth 2.1 + PKCE).
//
// Run: node server/server.ts [--port 8797]
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpHandler, isLegacyRequest, type McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport, localhostHostValidation, localhostOriginValidation, toNodeHandler, toWebRequest } from "@modelcontextprotocol/node";
import { createServices } from "./services.ts";
import { buildMcpServer, type Services } from "./tools.ts";
import { dataDir } from "./store.ts";

type AuthInfo = { token: string; clientId: string; scopes: string[]; extra: { userId: string } };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_DIR = join(ROOT, "node_modules", "@fontsource", "nunito", "files");
const FONTS = new Set(["nunito-latin-400-normal.woff2", "nunito-latin-600-normal.woff2", "nunito-latin-700-normal.woff2", "nunito-latin-800-normal.woff2"]);
const TOKEN = /^innet-sandbox-([A-Za-z0-9_.-]{1,64})$/;

function hostOrigins(): Set<string> {
  const port = process.env.HOST_PORT ?? "5188";
  const extra = (process.env.HOST_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...extra]);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

function jsonRpcError(res: ServerResponse, status: number, message: string, code = -32000, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

function applyCors(req: IncomingMessage, res: ServerResponse, origins: Set<string>): void {
  const origin = req.headers.origin;
  if (origin && origins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, MCP-Protocol-Version");
  }
}

function authOf(req: IncomingMessage): AuthInfo | null {
  const m = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i);
  const t = m?.[1].match(TOKEN);
  return t ? { token: m![1], clientId: "alexa-plus-host-simulator", scopes: ["innetwork"], extra: { userId: t[1] } } : null;
}

const readJson = (f: string) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; } catch { return null; } };
function devinfo(sv: Services, sessions: number) {
  const audits = existsSync(join(ROOT, "docs")) ? readdirSync(join(ROOT, "docs")).filter((f) => /^AUDIT.*\.json$/.test(f)).sort() : [];
  const verify = readJson(join(ROOT, "logs", "verify-latest.json")) as { pass: boolean }[] | null;
  return {
    directoryMode: sv.directory.mode,
    plans: sv.directory.plans.map((p) => ({ planId: p.planId, label: p.label, ...p.dev })),
    probes: Object.fromEntries(sv.probes),
    verify: verify ? { total: verify.length, pass: verify.filter((r) => r.pass).length, file: "logs/verify-latest.json" } : null,
    audits: Object.fromEntries(audits.map((f) => [f, readJson(join(ROOT, "docs", f))?.summary ?? null])),
    sessions,
    now: new Date(sv.now()).toISOString(),
  };
}

export type RunningServer = { url: string; port: number; close: () => Promise<void>; sessions: () => number; services: Services };

export async function startMcpServer(opts: { port: number; quiet?: boolean; services?: Services }): Promise<RunningServer> {
  const log = (...a: unknown[]) => { if (!opts.quiet) console.log(new Date().toISOString(), ...a); };
  const services = opts.services ?? (await createServices());
  const origins = hostOrigins();
  const sessions = new Map<string, { transport: NodeStreamableHTTPServerTransport; server: McpServer; userId: string }>();
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  let assetBase = process.env.PUBLIC_BASE ?? "";
  const modern = createMcpHandler((ctx) => buildMcpServer({ era: ctx.era, services, assetBase }), { legacy: "reject", onerror: (e) => log("modern leg error:", e.message) });
  const modernNode = toNodeHandler(modern, { onerror: (e) => log("modern adapter error:", e.message) });

  const http: HttpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, protocols: ["2025-11-25", "2026-07-28"], sessions: sessions.size, directoryMode: services.directory.mode, dataDir: dataDir() }));
        return;
      }
      if (url.pathname === "/devinfo") {
        applyCors(req, res, origins);
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(devinfo(services, sessions.size)));
        return;
      }
      if (url.pathname.startsWith("/assets/fonts/")) {
        const name = url.pathname.slice("/assets/fonts/".length);
        if (!FONTS.has(name) || req.method !== "GET") { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": "font/woff2", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400" });
        res.end(readFileSync(join(FONT_DIR, name)));
        return;
      }
      if (url.pathname !== "/mcp") { jsonRpcError(res, 404, "Not found"); return; }
      // DNS-rebinding guards (spec: servers MUST validate Origin). They answer 403 themselves.
      if (!validateHost(req, res) || !validateOrigin(req, res)) return;
      applyCors(req, res, origins);
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

      const auth = authOf(req);
      if (!auth) {
        jsonRpcError(res, 401, "Account not linked: send Authorization: Bearer innet-sandbox-<user> (simulated account linking)", -32001, { "WWW-Authenticate": 'Bearer realm="innetwork-sandbox"' });
        return;
      }
      (req as IncomingMessage & { auth?: AuthInfo }).auth = auth;

      const body = req.method === "POST" ? await readJsonBody(req) : undefined;
      const probe = await toWebRequest(req, body);
      if (!(await isLegacyRequest(probe, body))) { await modernNode(req, res, body); return; } // 2026-07-28

      // ---- 2025-11-25 leg: stateful sessions ----
      const sid = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(sid) ? sid[0] : sid;
      if (req.method === "POST") {
        if (sessionId) {
          const s = sessions.get(sessionId);
          if (!s) { jsonRpcError(res, 404, "Session not found", -32001); return; }
          if (s.userId !== auth.extra.userId) { jsonRpcError(res, 403, "Session belongs to another account", -32001); return; }
          await s.transport.handleRequest(req, res, body);
          return;
        }
        const server = buildMcpServer({ era: "legacy", services, assetBase });
        const transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => { sessions.set(id, { transport, server, userId: auth.extra.userId }); log(`session open  ${id} user=${auth.extra.userId}`); },
          onsessionclosed: (id) => { sessions.delete(id); log(`session close ${id} (DELETE)`); },
        });
        transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); server.close().catch(() => {}); };
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        if (!transport.sessionId) await transport.close().catch(() => {}); // not an initialize: nothing to keep
        return;
      }
      if (req.method === "GET" || req.method === "DELETE") {
        if (!sessionId) { jsonRpcError(res, 400, "Bad Request: Mcp-Session-Id header required"); return; }
        const s = sessions.get(sessionId);
        if (!s) { jsonRpcError(res, 404, "Session not found", -32001); return; }
        if (s.userId !== auth.extra.userId) { jsonRpcError(res, 403, "Session belongs to another account", -32001); return; }
        await s.transport.handleRequest(req, res);
        return;
      }
      res.setHeader("Allow", "GET, POST, DELETE, OPTIONS");
      jsonRpcError(res, 405, "Method not allowed");
    } catch (err) {
      console.error("request error:", err);
      const parse = err instanceof SyntaxError;
      if (!res.headersSent) jsonRpcError(res, parse ? 400 : 500, parse ? "Parse error" : "Internal error", parse ? -32700 : -32603);
      else res.end();
    }
  });

  await new Promise<void>((resolve, reject) => { http.once("error", reject); http.listen(opts.port, "127.0.0.1", () => resolve()); });
  const addr = http.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port;
  if (!assetBase) assetBase = `http://127.0.0.1:${port}`;
  log(`innetwork MCP on http://127.0.0.1:${port}/mcp (2025-11-25 strict sessions + 2026-07-28; directory=${services.directory.mode}; data=${dataDir()})`);
  return {
    url: `http://127.0.0.1:${port}/mcp`, port, services,
    sessions: () => sessions.size,
    close: async () => {
      for (const { transport } of sessions.values()) await transport.close().catch(() => {});
      sessions.clear();
      await modern.close().catch(() => {});
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--port");
  const port = i >= 0 ? Number(args[i + 1]) : Number(process.env.MCP_PORT ?? 8797);
  const running = await startMcpServer({ port });
  const shutdown = () => { running.close().then(() => process.exit(0)); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

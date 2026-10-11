// The skill's MCP client of the InNetwork server: Streamable HTTP, simulated account linking
// ("Authorization: Bearer innet-sandbox-<household>"), one MCP session per Alexa session, and a hard deadline
// (Alexa waits at most 8 s for a skill response; we give the whole call 6 s).
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";

export type Outcome =
  | { kind: "ok"; text: string; structured: Record<string, any> | null; isError: boolean; ms: number }
  | { kind: "timeout"; ms: number }
  | { kind: "error"; message: string };

export type InNetwork = { call(sessionKey: string, tool: string, args: Record<string, unknown>): Promise<Outcome>; close(): Promise<void> };

export function connectInNetwork(opts: { url: string; token: string; timeoutMs?: number }): InNetwork {
  const timeoutMs = opts.timeoutMs ?? 6000;
  const sessions = new Map<string, { client: Client; transport: StreamableHTTPClientTransport }>();
  const drop = async (k: string) => {
    const s = sessions.get(k);
    sessions.delete(k);
    if (s) { await s.transport.terminateSession().catch(() => {}); await s.client.close().catch(() => {}); }
  };
  async function once(k: string, tool: string, args: Record<string, unknown>, signal: AbortSignal, left: () => number): Promise<Outcome> {
    let s = sessions.get(k);
    if (!s) {
      const client = new Client({ name: "innetwork-alexa-skill", version: "0.1.0" });
      const transport = new StreamableHTTPClientTransport(new URL(opts.url), { requestInit: { headers: { Authorization: `Bearer ${opts.token}` }, signal } });
      await client.connect(transport, { signal, timeout: left() });
      s = { client, transport };
      sessions.set(k, s);
    }
    const t0 = performance.now();
    const r = (await s.client.callTool({ name: tool, arguments: args }, { signal, timeout: Math.max(1, left()) })) as CallToolResult;
    const text = (r.content ?? []).filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join(" ").trim();
    return { kind: "ok", text, structured: (r.structuredContent as Record<string, any>) ?? null, isError: r.isError === true, ms: Math.round(performance.now() - t0) };
  }
  return {
    async call(k, tool, args) {
      const started = Date.now();
      const left = () => timeoutMs - (Date.now() - started);
      const ac = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<Outcome>((resolve) => { timer = setTimeout(() => { ac.abort(); resolve({ kind: "timeout", ms: Date.now() - started }); }, timeoutMs); });
      try {
        try {
          return await Promise.race([once(k, tool, args, ac.signal, left), deadline]);
        } catch (e) {
          if (ac.signal.aborted || left() < 1000) throw e;
          await drop(k); // a cached session can die with a server restart (404): retry once, fresh
          return await Promise.race([once(k, tool, args, ac.signal, left), deadline]);
        }
      } catch (e) {
        await drop(k);
        return ac.signal.aborted ? { kind: "timeout", ms: Date.now() - started } : { kind: "error", message: String((e as Error).message ?? e) };
      } finally { clearTimeout(timer); }
    },
    async close() { for (const k of [...sessions.keys()]) await drop(k); },
  };
}

// npm run demo — build, then start the InNetwork MCP server and the Echo Show 8 simulator in one process. Offline by
// default (DIRECTORY_MODE=fixture: recorded directory samples from src/directory). Prints the URLs; Ctrl+C stops all.
//   ports (env): MCP_PORT 8797, HOST_PORT 5188, SANDBOX_PROXY_PORT 5189
//   --open   also open the host page in the default browser
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Services } from "../server/tools.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function free(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

export async function runDemo(opts: { services?: Services; label?: string; open?: boolean } = {}) {
  process.env.DIRECTORY_MODE ??= "fixture";
  const ports = { mcp: Number(process.env.MCP_PORT ?? 8797), host: Number(process.env.HOST_PORT ?? 5188), proxy: Number(process.env.SANDBOX_PROXY_PORT ?? 5189) };
  process.env.HOST_PORT = String(ports.host); // the MCP server allows this origin (CORS for /devinfo, Origin check)
  const envName = { mcp: "MCP_PORT", host: "HOST_PORT", proxy: "SANDBOX_PROXY_PORT" } as const;
  for (const [name, port] of Object.entries(ports) as [keyof typeof ports, number][]) {
    if (!(await free(port))) { console.error(`port ${port} (${name}) is in use; stop that process or set ${envName[name]}`); process.exit(1); }
  }
  const b = spawnSync(process.execPath, ["build.ts"], { cwd: ROOT, stdio: "inherit" });
  if (b.status !== 0) process.exit(b.status ?? 1);

  const { startMcpServer } = await import("../server/server.ts");
  const { startHost } = await import("../host/serve.ts");
  const mcp = await startMcpServer({ port: ports.mcp, ...(opts.services ? { services: opts.services } : {}) });
  const host = await startHost({ hostPort: ports.host, proxyPort: ports.proxy, mcpUrl: mcp.url });

  console.log("");
  console.log(`InNetwork demo is running (directory: ${opts.label ?? `src/directory, mode ${process.env.DIRECTORY_MODE}`}; offline: ${process.env.DIRECTORY_MODE === "fixture"})`);
  console.log(`  Echo Show 8 simulator  ${host.hostUrl}   <- open this, press "Play demo"`);
  console.log(`  behind the scenes      ${host.hostUrl}?view=developer`);
  console.log(`  MCP endpoint           ${mcp.url}   (2025-11-25 sessions + 2026-07-28)`);
  console.log(`  view sandbox (origin 2) ${host.proxyUrl}`);
  console.log("Ctrl+C stops everything.");
  if (opts.open || process.argv.includes("--open")) spawnSync("open", [host.hostUrl]);

  const shutdown = async () => {
    await host.close().catch(() => {});
    await mcp.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return { mcp, host };
}

if (import.meta.main) await runDemo();

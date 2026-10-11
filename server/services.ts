// Wires the server to the directory service (src/directory, recorded samples + live adapters), the demo scenario and
// the sandbox clock. Tests pass their own directory (server/dev-directory.ts).
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DirectoryService } from "../src/core/types.ts";
import { loadScenario, POLICIES_SEED } from "./scenario.ts";
import type { Services } from "./tools.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function createDirectoryService(): Promise<DirectoryService> {
  const entry = join(ROOT, "src", "directory", "index.ts");
  if (!existsSync(entry)) throw new Error("src/directory/index.ts is missing (directory adapters)");
  const mod = (await import(pathToFileURL(entry).href)) as { createDirectory: (o: { mode?: "fixture" | "live" | "auto" }) => DirectoryService };
  const mode = (process.env.DIRECTORY_MODE as "fixture" | "live" | "auto" | undefined) ?? "fixture";
  return mod.createDirectory({ mode });
}

export async function createServices(opts: { directory?: DirectoryService; now?: () => number } = {}): Promise<Services> {
  const scenario = loadScenario();
  const directory = opts.directory ?? (await createDirectoryService());
  return { directory, scenario, policiesSeed: existsSync(POLICIES_SEED) ? POLICIES_SEED : null, now: opts.now ?? (() => scenario.now), probes: new Map() };
}

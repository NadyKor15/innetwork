// Host-lane development only: the same as `npm run demo`, but against the server's test double of the directory
// (server/dev-directory.ts) and its demo office policies, with household files in a throwaway folder. Use this while
// src/directory is not in the tree; `npm run demo` and verify use src/directory.
//   node scripts/dev-host.ts [--open]
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.INNETWORK_DATA_DIR ??= mkdtempSync(join(tmpdir(), "innetwork-dev-"));
const { devDirectory, DEV_POLICIES } = await import("../server/dev-directory.ts");
const { createServices } = await import("../server/services.ts");
const { runDemo } = await import("./demo.ts");
const seed = join(process.env.INNETWORK_DATA_DIR, "policies-seed.json");
writeFileSync(seed, JSON.stringify(DEV_POLICIES));
const services = await createServices({ directory: devDirectory() });
services.policiesSeed = seed;
await runDemo({ services, label: `TEST DOUBLE server/dev-directory.ts (data ${process.env.INNETWORK_DATA_DIR})` });

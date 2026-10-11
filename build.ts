// Bundles the browser code with esbuild:
//   dist/host.js            Echo Show 8 simulator (MCP client + AppBridge), ES module
//   dist/host.css           host styling (copied)
//   dist/sandbox.js         sandbox proxy (second origin)
//   dist/views/<view>.html  MCP App views, one self-contained HTML each (the same screens bundle + CSS inlined),
//                           served as ui://innetwork/<view>.html. The screen is chosen by structuredContent.card.view,
//                           not by the file name. __INNETWORK_ASSET_BASE__ is replaced by the server (fonts origin).
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");
const VIEW_FILES = ["family-match", "set-aside", "visit-plan", "booked", "checkup-year", "consent"] as const;
mkdirSync(join(DIST, "views"), { recursive: true });

const common = { bundle: true, platform: "browser" as const, target: "es2022", minify: true, legalComments: "none" as const, logLevel: "warning" as const };

await build({ ...common, entryPoints: [join(ROOT, "host", "host.ts")], outfile: join(DIST, "host.js"), format: "esm" });
await build({ ...common, entryPoints: [join(ROOT, "host", "sandbox.ts")], outfile: join(DIST, "sandbox.js"), format: "iife" });
copyFileSync(join(ROOT, "host", "host.css"), join(DIST, "host.css"));

const view = await build({ ...common, entryPoints: [join(ROOT, "views", "screens.ts")], format: "iife", write: false });
const js = view.outputFiles[0].text.replaceAll("</script", "<\\/script");
const css = readFileSync(join(ROOT, "views", "screens.css"), "utf8").replaceAll("</style", "<\\/style");
let bytes = 0;
for (const v of VIEW_FILES) {
  const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>InNetwork · ${v}</title>
<style>${css}</style>
</head>
<body data-file="${v}">
<main id="root" class="scr"></main>
<script>${js}</script>
</body>
</html>
`;
  writeFileSync(join(DIST, "views", `${v}.html`), html);
  bytes = html.length;
}
console.log(`built dist/host.js, dist/sandbox.js, dist/host.css, dist/views/{${VIEW_FILES.join(",")}}.html (${(bytes / 1024).toFixed(0)} KB each)`);

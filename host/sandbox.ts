// Sandbox proxy: the outer iframe of every add-on view, served from a second origin (SANDBOX_PROXY_PORT).
// MCP Apps "sandbox proxy": announce readiness, write the view HTML into an inner iframe when the host sends
// ui/notifications/sandbox-resource-ready, and relay every other message both ways. The inner document inherits this
// document's CSP (set by host/serve.ts from the view's _meta.ui.csp).

const ALLOWED: string[] = (self as unknown as { __INNET_HOST_ORIGINS?: string[] }).__INNET_HOST_ORIGINS ?? ["http://127.0.0.1:5188", "http://localhost:5188"];
const PROXY_READY = "ui/notifications/sandbox-proxy-ready";
const RESOURCE_READY = "ui/notifications/sandbox-resource-ready";

if (window.self === window.top) throw new Error("sandbox proxy must be embedded by the host");
const hostOrigin = document.referrer ? new URL(document.referrer).origin : "";
if (!ALLOWED.includes(hostOrigin)) throw new Error(`embedding origin not allowed: ${hostOrigin || "(no referrer)"}`);
const own = location.origin;

// Isolation self-test: the host document must be unreachable from here.
let reachable = false;
try { void (window.top as Window).document.title; reachable = true; } catch { /* expected: cross-origin */ }
if (reachable) throw new Error("sandbox isolation broken: host document is reachable");

const inner = document.createElement("iframe");
inner.setAttribute("sandbox", "allow-scripts allow-same-origin");
inner.setAttribute("title", "add-on view");
inner.style.cssText = "width:100%;height:100%;border:0;display:block;background:transparent";
document.body.append(inner);

window.addEventListener("message", (event) => {
  if (event.source === window.parent) {
    if (event.origin !== hostOrigin) return;
    if (event.data?.method === RESOURCE_READY) {
      const html = event.data.params?.html;
      if (typeof html !== "string") return;
      const doc = inner.contentDocument;
      if (doc) { doc.open(); doc.write(html); doc.close(); }
      else inner.srcdoc = html;
      return;
    }
    inner.contentWindow?.postMessage(event.data, own);
  } else if (event.source === inner.contentWindow) {
    if (event.origin !== own) return;
    window.parent.postMessage(event.data, hostOrigin);
  }
});

window.parent.postMessage({ jsonrpc: "2.0", method: PROXY_READY, params: {} }, hostOrigin);

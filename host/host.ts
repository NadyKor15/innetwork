// Echo Show 8 simulator: the Alexa+ experience simulated in our web host.
// - Official MCP client over Streamable HTTP; simulated account linking "Authorization: Bearer innet-sandbox-<user>".
// - Language understanding is simulated deterministically: parseUtterance (src/core/intent.ts), no model. N1/N7
//   refusals are spoken by the host without any tool call; "yes" with a pending booking -> book_visit {confirm:true};
//   "no" books nothing.
// - Add-on views are MCP Apps: AppBridge + a sandbox proxy on a second origin, CSP from the view's _meta.ui.csp,
//   ui/resource-teardown before every view change. hostContext carries theme + deviceClass "echo-show-8"; the theme
//   switch goes out as host-context-changed.
// - Inside the screen the host draws the add-on attribution row and the conversation band (the reference screens'
//   geometry); the view sits below. Alexa's lines go to the subtitle bar with their seconds, one speech part at a time.
// - Developer view (beside the device, never inside it): one chip per tools/call with _meta.steps and source badges;
//   full-screen "Behind the scenes" (screen 07) from /devinfo + the latest _meta.steps/_meta.gate.
import { Client, StreamableHTTPClientTransport, type CallToolResult, type Tool } from "@modelcontextprotocol/client";
import { AppBridge, PostMessageTransport, RESOURCE_MIME_TYPE, getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import { parseUtterance } from "../src/core/intent.ts";
import { seconds as secondsOf } from "../src/core/lint.ts";

type Cfg = { mcpUrl: string; devinfoUrl: string; sandboxProxyUrl: string };
type Mode = "live" | "file" | "fixture" | "sandbox" | "simulated";
type Step = { service: string; op: string; mode: Mode; ms: number; summary: string };
type SC = { speech?: string; speechParts?: string[]; seconds?: number[]; view?: string | null; card?: { view: string; [k: string]: unknown } | null; data?: Record<string, unknown> };
type Turn = { n: number; source: "typed" | "voice" | "tap" | "demo"; utterance: string; tool: string | null; args: Record<string, unknown> | null; speech: string; parts: string[]; seconds: number[]; steps: Step[]; gate: string[] | null; isError: boolean; view: string | null; ms: number; beat: number; local: string | null };
type Pending = { kind: "book" | "cancel" | "consent"; flags: { book_anyway?: boolean; book_over_routine?: boolean } } | null;
type DevInfo = { directoryMode: string; plans: { planId: string; label: string; insurer: string; product: string; kind: string; programType: string; sourceMode: Mode }[]; probes: Record<string, { ok: boolean; directory: string; ms: number; asOf: string; ref: string; inNetworkCount?: number; error?: string }>; verify: { total: number; pass: number; file: string } | null; audits: Record<string, unknown>; sessions: number; now: string };

const CFG = (window as unknown as { __INNET: Cfg }).__INNET;
const HOST_INFO = { name: "alexa-plus-host-simulator", version: "0.1.0" };
const UI_EXTENSION_ID = "io.modelcontextprotocol/ui";
const params = new URLSearchParams(location.search);
const FAST = params.get("pace") === "fast";
const HOLD = params.get("hold") === "1";
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BAND: Record<string, string> = { "family-match": "framed-fm", "checkup-year": "framed-cy", "set-aside": "open-sa", "visit-plan": "quote-vp", booked: "none", consent: "none" };
const ZOOM = 1.667;

const state = {
  userId: params.get("user") ?? `demo-${Date.now().toString(36)}`,
  theme: (params.get("theme") === "light" ? "light" : "dark") as "dark" | "light",
  protocolVersion: "",
  sessionId: "",
  tools: [] as string[],
  sessionsOpened: 0,
  turns: [] as Turn[],
  pending: null as Pending,
  card: { renders: 0, initialized: 0, teardowns: 0, view: "", views: [] as string[] },
  demo: { running: false, beat: 0, done: false, runs: 0 },
  beat: 0,
  hold: "",
  devboard: { shown: 0, verify: "", probe: "" },
  themeChanges: 0,
  errors: [] as string[],
};
(window as unknown as { __host: typeof state }).__host = state;
document.documentElement.dataset.theme = state.theme;

let client: Client | undefined;
let transport: StreamableHTTPClientTransport | undefined;
let tools = new Map<string, Tool>();
let bridge: AppBridge | undefined;
let iframeEl: HTMLIFrameElement | undefined;
let queue: Promise<unknown> = Promise.resolve();
let subtitleRun = 0;
// latest data for screen 07
const last = { familyRows: null as { member: string; memberLabel: string; planLabel: string }[] | null, familySteps: [] as Step[], gate: null as string[] | null, bookSteps: [] as Step[], lookupSteps: [] as Step[] };

// ---------- recording hooks (scripts/record-demo.ts exposes these; no-ops otherwise) ----------
type Hooks = { __cue?: (c: { who: "mom" | "alexa"; text: string; beat: number }) => void; __beatMark?: (b: { beat: number; label: string }) => void };
const hooks = window as unknown as Hooks;
const cue = (who: "mom" | "alexa", text: string) => { try { hooks.__cue?.({ who, text, beat: state.beat }); } catch { /* recorder gone */ } };

// ---------- screen: attribution row + conversation band ----------
function setBand(view: string, utterance: string, speech: string): void {
  const band = BAND[view] ?? "none";
  const screen = $("screen");
  screen.dataset.view = view;
  screen.dataset.band = band;
  $("chrome").hidden = false;
  const said = utterance.trim();
  let ask = said ? `“${said}”` : "";
  let r1 = speech, r2 = "";
  if (band === "quote-vp") {
    const sentences = said.split(/(?<=[.!?])\s+/).filter(Boolean);
    ask = sentences.length ? `“${sentences[sentences.length - 1]}”` : "";
    r1 = "";
  } else if (band === "open-sa") {
    const m = speech.match(/^(.+?[.!?])\s+(.+)$/);
    if (m) { r1 = m[1]; r2 = m[2]; }
  }
  $("band-ask").textContent = ask;
  $("band-reply-1").textContent = r1;
  $("band-reply-2").textContent = r2;
}

// ---------- subtitles: Alexa's line(s) with seconds, one speech part at a time ----------
async function subtitles(user: string | null, parts: string[], secs?: number[]): Promise<void> {
  const run = ++subtitleRun;
  if (user !== null) $("sub-user").textContent = user;
  if (!parts.length) { $("sub-alexa").textContent = ""; $("sub-seconds").textContent = ""; return; }
  for (let i = 0; i < parts.length; i++) {
    if (run !== subtitleRun) return;
    const s = secs?.[i] ?? secondsOf(parts[i]);
    $("sub-alexa").textContent = parts[i];
    $("sub-alexa").dataset.part = `${i + 1}/${parts.length}`;
    $("sub-seconds").textContent = `${s.toFixed(1)} s`;
    cue("alexa", parts[i]);
    if (i < parts.length - 1) await sleep(FAST ? 60 : Math.round(s * 1000) + 350);
  }
}

// ---------- developer view chips ----------
function chip(label: string, args: string | null): { done: (steps: Step[], ms: number, gate?: string[] | null, error?: string) => void } {
  const el = document.createElement("div");
  el.className = "chip";
  el.dataset.state = "pending";
  const head = document.createElement("div");
  head.className = "chip-head";
  const code = document.createElement("code");
  code.textContent = label;
  const ms = document.createElement("span");
  ms.className = "ms";
  ms.textContent = "…";
  head.append(code, ms);
  el.append(head);
  if (args) { const a = document.createElement("div"); a.className = "chip-args"; a.textContent = args; el.append(a); }
  const ul = document.createElement("ul");
  ul.className = "steps";
  el.append(ul);
  $("chips").prepend(el);
  return {
    done(steps, total, gate, error) {
      el.dataset.state = error ? "error" : "done";
      ms.textContent = `${total} ms`;
      for (const s of steps) {
        const li = document.createElement("li");
        li.className = "step";
        const b = document.createElement("span");
        b.className = "badge";
        b.dataset.mode = s.mode;
        b.textContent = s.mode.toUpperCase();
        const t = document.createElement("span");
        t.className = "step-text";
        t.append(`${s.service} · ${s.op}`);
        const sum = document.createElement("span");
        sum.className = "step-sum";
        sum.textContent = s.summary;
        t.append(sum);
        const m = document.createElement("span");
        m.className = "step-ms";
        m.textContent = s.ms > 0 ? `${s.ms} ms` : "";
        li.append(b, t, m);
        ul.append(li);
      }
      if (gate?.length) {
        const g = document.createElement("div");
        g.className = "chip-gate";
        for (const line of gate) { const p = document.createElement("p"); p.textContent = line; g.append(p); }
        el.append(g);
      }
      if (error) {
        const li = document.createElement("li");
        li.className = "step";
        li.dataset.error = "1";
        const t = document.createElement("span");
        t.className = "step-text";
        t.textContent = `error: ${error}`;
        li.append(document.createElement("span"), t);
        ul.append(li);
      }
    },
  };
}

function record(t: Omit<Turn, "n" | "beat" | "seconds"> & { seconds?: number[] }): Turn {
  const turn: Turn = { ...t, n: state.turns.length + 1, beat: state.beat, seconds: t.seconds ?? t.parts.map(secondsOf) };
  state.turns.push(turn);
  document.body.dataset.turns = String(state.turns.length);
  if (t.isError && t.local === null && t.tool === null) state.errors.push(t.speech);
  return turn;
}

// ---------- MCP connection ----------
async function connect(): Promise<void> {
  client = new Client(HOST_INFO, { capabilities: { extensions: { [UI_EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } } });
  transport = new StreamableHTTPClientTransport(new URL(CFG.mcpUrl), { requestInit: { headers: { Authorization: `Bearer innet-sandbox-${state.userId}` } } });
  await client.connect(transport);
  state.protocolVersion = client.getNegotiatedProtocolVersion() ?? "(unknown)";
  state.sessionId = transport.sessionId ?? "(none)";
  state.sessionsOpened += 1;
  tools = new Map((await client.listTools()).tools.map((t) => [t.name, t]));
  state.tools = [...tools.keys()];
  $("user").textContent = state.userId;
  $("protocol").textContent = state.protocolVersion;
  $("session").textContent = state.sessionId.slice(0, 8);
  $("session").title = state.sessionId;
  document.body.dataset.connected = String(state.sessionsOpened);
  void devinfo().then((d) => { if (d) $("dir-mode").textContent = d.directoryMode; });
}

async function teardownCard(): Promise<void> {
  if (bridge) {
    // MCP Apps: the host sends ui/resource-teardown before removing a view.
    await Promise.race([bridge.teardownResource({}), sleep(1000)]).catch(() => {});
    await bridge.close().catch(() => {});
    bridge = undefined;
    state.card.teardowns += 1;
  }
  iframeEl = undefined;
  $("card").replaceChildren();
}

function hostContext(view: string) {
  const height = Math.round($("card").getBoundingClientRect().height);
  return {
    theme: state.theme, platform: "web" as const, displayMode: view === "visit-plan" ? ("fullscreen" as const) : ("inline" as const),
    availableDisplayModes: ["inline" as const, "fullscreen" as const], deviceClass: "echo-show-8", locale: "en-US", timeZone: "America/New_York",
    containerDimensions: { width: 1280, height }, deviceCapabilities: { touch: true, hover: false }, safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
}

/** Calls a tool that declares a UI resource; when the result carries a card, swaps in a fresh view for it. */
async function callWithView(toolName: string, args: Record<string, unknown>, uri: string, utterance: string): Promise<CallToolResult> {
  const c = client!;
  const [result, resource] = await Promise.all([
    c.callTool({ name: toolName, arguments: args }) as Promise<CallToolResult>,
    c.readResource({ uri }),
  ]);
  const sc = (result.structuredContent ?? {}) as SC;
  const card = sc.card;
  if (!card) return result; // voice-only answer: the current view stays
  const content = resource.contents[0];
  if (!content || content.mimeType !== RESOURCE_MIME_TYPE || !("text" in content)) throw new Error(`unexpected UI resource: ${content?.mimeType}`);

  await teardownCard();
  exitDeveloper();
  setBand(card.view, utterance, sc.speech ?? "");
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin"); // the proxy sits on another origin
  iframe.title = `InNetwork ${card.view}`;
  const proxyReady = new Promise<void>((resolve) => {
    const onMsg = (e: MessageEvent) => {
      if (e.source === iframe.contentWindow && e.data?.method === "ui/notifications/sandbox-proxy-ready") { window.removeEventListener("message", onMsg); resolve(); }
    };
    window.addEventListener("message", onMsg);
  });
  const csp = (content as { _meta?: { ui?: { csp?: { resourceDomains?: string[]; connectDomains?: string[] } } } })._meta?.ui?.csp ?? {};
  iframe.src = `${CFG.sandboxProxyUrl}?csp=${encodeURIComponent(JSON.stringify({ resourceDomains: csp.resourceDomains ?? [], connectDomains: csp.connectDomains ?? [] }))}`;
  $("card").append(iframe);
  iframeEl = iframe;
  await proxyReady;

  const caps = c.getServerCapabilities();
  const b = new AppBridge(c, HOST_INFO, { serverTools: caps?.tools, serverResources: caps?.resources, message: { text: {} } }, { hostContext: hostContext(card.view) });
  bridge = b;
  b.onloggingmessage = (p) => console.log("[view log]", p);
  b.onmessage = async ({ content: blocks }) => {
    // A tap in the view (Allow / Not now) arrives as ui/message: the user's next turn.
    const text = blocks.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join(" ").trim();
    if (text) void enqueue(text, "tap");
    return {};
  };
  const initialized = new Promise<void>((resolve) => { b.oninitialized = () => { state.card.initialized += 1; resolve(); }; });
  await b.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  await b.sendSandboxResourceReady({ html: content.text });
  await initialized; // nothing goes to the view before it is initialized
  await b.sendToolInput({ arguments: args });
  await b.sendToolResult(result);
  state.card.renders += 1;
  state.card.view = card.view;
  state.card.views.push(card.view);
  iframe.dataset.rendered = String(state.card.renders);
  iframe.dataset.view = card.view;
  document.body.dataset.view = card.view;
  return result;
}

async function newSession(): Promise<void> {
  const before = state.sessionId;
  const c = chip("New MCP session", null);
  const t0 = performance.now();
  if (transport) await transport.terminateSession().catch(() => {}); // HTTP DELETE: the server drops the session
  if (client) await client.close().catch(() => {});
  await connect();
  c.done([{ service: "MCP", op: "DELETE + initialize", mode: "simulated", ms: 0, summary: `${before.slice(0, 8)}… → ${state.sessionId.slice(0, 8)}… · household state stays on the server` }], Math.round(performance.now() - t0));
  state.pending = null;
  void subtitles("", []);
}

async function resetHousehold(): Promise<void> {
  state.userId = `demo-${Date.now().toString(36)}`; // new household: the server keeps state per account
  state.pending = null;
  last.familyRows = null; last.familySteps = []; last.gate = null; last.bookSteps = []; last.lookupSteps = [];
  await teardownCard();
  exitDeveloper();
  $("chrome").hidden = true;
  $("screen").dataset.view = "";
  $("screen").dataset.band = "none";
  $("chips").replaceChildren();
  void subtitles("", []);
  if (transport) await transport.terminateSession().catch(() => {});
  if (client) await client.close().catch(() => {});
  await connect();
}

// ---------- turns ----------
function pendingAfter(tool: string, sc: SC, isError: boolean): Pending {
  const d = sc.data ?? {};
  if (d.consentRequired) return { kind: "consent", flags: {} };
  if (tool === "consent") return d.consent === "asked" ? { kind: "consent", flags: {} } : null;
  if (tool === "find_in_network") return (Array.isArray(d.proposals) && d.proposals.length) || d.proposal ? { kind: "book", flags: {} } : null;
  if (tool === "checkup_year") return Array.isArray(d.proposals) && d.proposals.length ? { kind: "book", flags: {} } : null;
  if (tool === "book_visit") {
    if (d.needsConfirmation === "book_anyway") return { kind: "book", flags: { ...(state.pending?.flags ?? {}), book_anyway: true } };
    if (d.needsConfirmation === "book_over_routine") return { kind: "book", flags: { ...(state.pending?.flags ?? {}), book_over_routine: true } };
    if (d.readBack) return { kind: "book", flags: state.pending?.flags ?? {} };
    return isError ? state.pending : null;
  }
  if (tool === "cancel_visit") return d.needsConfirmation ? { kind: "cancel", flags: {} } : null;
  return state.pending;
}

async function runTool(tool: string, args: Record<string, unknown>, utterance: string, source: Turn["source"]): Promise<Turn> {
  if (!client) throw new Error("not connected");
  const c = chip(`tools/call innetwork.${tool}`, JSON.stringify(args));
  const t0 = performance.now();
  const def = tools.get(tool);
  const uri = def ? getToolUiResourceUri(def) : undefined;
  let result: CallToolResult;
  try {
    result = uri ? await callWithView(tool, args, uri, utterance) : ((await client.callTool({ name: tool, arguments: args })) as CallToolResult);
  } catch (err) {
    c.done([], Math.round(performance.now() - t0), null, String(err));
    throw err;
  }
  const meta = (result._meta ?? {}) as { steps?: Step[]; gate?: string[] };
  const steps = meta.steps ?? [];
  const ms = Math.round(performance.now() - t0);
  c.done(steps, ms, meta.gate ?? null);
  const sc = (result.structuredContent ?? {}) as SC;
  const speech = sc.speech ?? result.content.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join(" ");
  const parts = sc.speechParts?.length ? sc.speechParts : [speech];
  // screen 07 inputs
  if (meta.gate) last.gate = meta.gate;
  if (sc.card?.view === "family-match" && Array.isArray((sc.card as { rows?: unknown[] }).rows) && ((sc.card as { rows: unknown[] }).rows.length > 1) && tool === "find_in_network") {
    last.familyRows = ((sc.card as unknown as { rows: { member: string; memberLabel: string; planLabel: string }[] }).rows).map((r) => ({ member: r.member, memberLabel: r.memberLabel, planLabel: r.planLabel }));
    last.familySteps = steps;
  }
  if (steps.some((s) => / · ZIP /.test(s.op))) last.lookupSteps = steps;
  if (tool === "book_visit" && steps.some((s) => s.service === "Sandbox booking partner")) last.bookSteps = steps;
  state.pending = pendingAfter(tool, sc, !!result.isError);
  const turn = record({ source, utterance, tool, args, speech, parts, seconds: sc.seconds, steps, gate: meta.gate ?? null, isError: !!result.isError, view: sc.card?.view ?? null, ms, local: null });
  await subtitles(null, parts, sc.seconds);
  return turn;
}

async function localReply(text: string, utterance: string, source: Turn["source"], why: string): Promise<Turn> {
  const c = chip(`host · ${why}`, null);
  c.done([{ service: "Simulated Alexa+ host", op: why, mode: "simulated", ms: 0, summary: "spoken by the host; no tool call" }], 0);
  const turn = record({ source, utterance, tool: null, args: null, speech: text, parts: [text], steps: [], gate: null, isError: false, view: null, ms: 0, local: why });
  await subtitles(null, [text]);
  return turn;
}

async function handle(raw: string, source: Turn["source"]): Promise<Turn> {
  const said = raw.trim();
  void subtitles(said, []);
  if (source !== "demo") cue("mom", said);
  const p = state.pending;
  const intent = parseUtterance(said, p?.kind ?? null);
  switch (intent.kind) {
    case "refuse": return localReply(intent.line, said, source, `refusal ${intent.rule} (fixed line)`);
    case "help": return localReply(intent.line, said, source, "no matching request");
    case "yes":
      if (p?.kind === "book") return runTool("book_visit", { confirm: true, ...p.flags }, said, source);
      if (p?.kind === "cancel") return runTool("cancel_visit", { confirm: true }, said, source);
      if (p?.kind === "consent") return runTool("consent", { action: "allow" }, said, source);
      return localReply("There's nothing waiting for a yes right now.", said, source, "yes without a pending question");
    case "no":
      state.pending = null;
      return localReply(p?.kind === "cancel" ? "OK, I'll keep it." : "OK, I won't book anything.", said, source, "no: nothing booked");
    case "tool":
      return runTool(intent.name, intent.args, said, source);
  }
}

function enqueue(text: string, source: Turn["source"]): Promise<Turn | undefined> {
  const run = queue.then(async () => {
    document.body.dataset.busy = "1";
    try { return await handle(text, source); }
    catch (err) { void subtitles(null, ["Sorry, that didn't work."]); state.errors.push(String(err)); console.error(err); return undefined; }
    finally { document.body.dataset.busy = "0"; }
  });
  queue = run.catch(() => undefined);
  return run;
}

// ---------- full-screen developer view (screen 07) ----------
async function devinfo(): Promise<DevInfo | null> {
  try { return (await (await fetch(CFG.devinfoUrl, { cache: "no-store" })).json()) as DevInfo; } catch { return null; }
}
const SVGNS = "http://www.w3.org/2000/svg";
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, ...kids: (Node | string | null | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null && k !== false) e.append(typeof k === "string" ? document.createTextNode(k) : k);
  return e;
}
function s(tag: string, attrs: Record<string, string>, ...kids: SVGElement[]): SVGElement {
  const e = document.createElementNS(SVGNS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) e.append(k);
  return e;
}
const KIND_TEXT: Record<string, string> = { "fhir-plannet": "insurer directory (FHIR Plan-Net)", "qhp-file": "marketplace plan file (CMS QHP JSON)" };
const hhmm = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "?" : d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" }); };
const modeBadge = (mode: string, kind: string) => {
  const cls = mode === "live" ? "badge badge--live badge--fill" : `badge badge--${mode}`;
  return h("span", cls, mode === "live" && kind === "fhir-plannet" ? "LIVE FHIR" : mode.toUpperCase());
};

async function renderDevboard(): Promise<void> {
  const d = await devinfo();
  const board = $("devboard");
  const legend = h("ul", "legend", ...["live", "file", "fixture", "sandbox", "simulated"].map((m) => h("li", `badge badge--${m}`, m.toUpperCase())));
  legend.setAttribute("aria-label", "Source modes");
  const hdr = h("header", "hdr", h("h1", "hdr-title", "Behind the scenes — not shown to customers"), legend);

  // rows: who -> plan -> source (from the opening search: its card rows + its directory steps; else /devinfo plans)
  const plans = d?.plans ?? [];
  const rows = (last.familyRows ?? plans.map((p) => ({ member: "", memberLabel: "", planLabel: p.label }))).slice(0, 3);
  const grid = h("div", "board-grid");
  const memberCls = ["mom", "older", "youngest"];
  rows.forEach((r, i) => {
    const plan = plans.find((p) => p.label === r.planLabel);
    const step = last.familySteps.find((st) => st.op.endsWith(` · ${r.planLabel}`) && / · ZIP /.test(st.op));
    const mode = step?.mode ?? plan?.sourceMode ?? "fixture";
    const kind = plan?.kind ?? "";
    const kindText = KIND_TEXT[kind] ?? `${plan?.programType ?? "plan"} directory`;
    const recorded = mode === "fixture" ? " · recorded sample" : "";
    const who = r.memberLabel ? `${r.memberLabel} · ` : "";
    grid.append(h("div", `member member--${r.member || memberCls[i]} inner r${i + 1}`, h("span", "dot"), h("span", "member-name", r.memberLabel || r.planLabel)));
    grid.append(h("div", `source inner r${i + 1}`, h("p", "source-text", `${who}${r.planLabel} · ${kindText}${recorded}`), modeBadge(mode, kind)));
  });
  grid.append(linksIn(), linksGate());
  const gate = h("div", "gate inner", h("h3", "gate-title", "deterministic gate"));
  const log = h("ol", "gate-log");
  for (const line of last.gate ?? []) {
    const i = line.indexOf(" → ");
    log.append(h("li", "gate-entry", i > 0 ? h("span", "nb", line.slice(0, i + 2)) : null, i > 0 ? line.slice(i + 2) : line));
  }
  if (!last.gate) log.append(h("li", "gate-entry", "no search in this session yet"));
  gate.append(log);
  grid.append(gate);
  const boardEl = h("section", "board card", h("h2", "board-title", "Evidence board"), grid);

  // live strip: the latest live probe from /devinfo; else say plainly that nothing live ran
  const probe = Object.values(d?.probes ?? {}).filter((p) => p.ok).sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
  const liveStep = [...last.lookupSteps].reverse().find((st) => st.mode === "live" && /live network check/.test(st.op));
  const req = probe
    ? h("p", "req", `LIVE · ${probe.directory} · ${probe.ref} · `, h("span", "nb", `${probe.ms} ms`), " · as of ", h("span", "nb", hhmm(probe.asOf)))
    : h("p", "req", `LIVE · no live directory call in this run · directory mode: ${d?.directoryMode ?? "unknown"}`);
  state.devboard.probe = probe ? `${probe.directory} ${probe.ms} ms` : "none";
  const chain = h("p", "chain", "chain: ");
  const lookupMode = last.familySteps.find((st) => / · ZIP /.test(st.op))?.mode ?? last.lookupSteps.find((st) => / · ZIP /.test(st.op))?.mode;
  const modeOf = (service: string) => last.bookSteps.find((st) => st.service === service)?.mode;
  const links: [string, string | undefined][] = [["directory", lookupMode], ["booking", modeOf("Sandbox booking partner")], ["calendar", modeOf("Family calendar")], ["Alexa app + email", modeOf("Written confirmation")]];
  links.forEach(([label, mode], i) => {
    if (i) chain.append(" → ");
    chain.append(label);
    if (mode) chain.append(" ", h("span", mode === "sandbox" ? "sbx" : `m-${mode}`, mode.toUpperCase()));
  });
  const live = h("section", "strip strip--live card", req, chain);
  live.setAttribute("aria-label", "Live request");

  const count = liveStep ? liveStep.summary : (() => {
    const st = [...last.lookupSteps].reverse().find((x) => / · ZIP /.test(x.op));
    return st ? `${st.summary} · ${st.op}` : "no directory lookup in this session yet";
  })();
  const v = d?.verify;
  const verifyText = v ? `verify ${v.pass}/${v.total} ${v.pass === v.total ? "PASS" : "· FAIL"}` : "verify — not run yet";
  state.devboard.verify = verifyText;
  const countStrip = h("section", "strip strip--count card", h("p", "count", count), h("span", v && v.pass === v.total ? "verify" : "verify verify--none", verifyText));
  countStrip.setAttribute("aria-label", "Result");

  const auditKeys = Object.keys(d?.audits ?? {});
  const foot = h("footer", "foot", s("svg", { class: "logo-mark", viewBox: "0 0 76 28", width: "38", height: "14", role: "img", "aria-label": "InNetwork" }, s("circle", { class: "c1", cx: "14", cy: "14", r: "13" }), s("circle", { class: "c2", cx: "35", cy: "14", r: "13" }), s("circle", { class: "c3", cx: "56", cy: "14", r: "13" })),
    h("span", "brand", "InNetwork"), auditKeys.length ? h("span", "audit", `audits: ${auditKeys.join(", ")}`) : null, h("span", "demo", "demo data"));
  board.replaceChildren(h("div", "db", hdr, boardEl, live, countStrip, foot));
  state.devboard.shown += 1;
  board.dataset.rendered = String(state.devboard.shown);
}
function linksIn(): SVGElement {
  const g = (cls: string, y: number) => s("g", { class: cls }, s("circle", { cx: "134.6", cy: String(y), r: "4.1" }), s("line", { x1: "134.6", y1: String(y), x2: "173.4", y2: String(y) }), s("polygon", { points: `172.6,${y - 3} 178.8,${y} 172.6,${y + 3}` }));
  return s("svg", { class: "links links--in", viewBox: "131.7 113.3 48.4 187.4", width: "48.4", height: "187.4", "aria-hidden": "true" }, g("mom", 139.45), g("older", 206.3), g("youngest", 275.5));
}
function linksGate(): SVGElement {
  return s("svg", { class: "links links--gate", viewBox: "460 113.3 61 187.4", width: "61", height: "187.4", "aria-hidden": "true" },
    s("g", { class: "mom" }, s("path", { d: "M460.5,138.7 C507,138.7 480.3,185.4 510.3,185.4 L514,185.4" }), s("polygon", { points: "513.6,182.2 520.6,185.4 513.6,188.6" })),
    s("g", { class: "older" }, s("path", { d: "M460.5,206 L514,206" }), s("polygon", { points: "513.6,202.8 520.6,206 513.6,209.2" })),
    s("g", { class: "youngest" }, s("path", { d: "M460.5,274.7 C507,274.7 478.9,227.5 510.3,227.5 L514,227.5" }), s("circle", { cx: "516.4", cy: "227.5", r: "3.9" })));
}
async function showDeveloper(): Promise<void> {
  await renderDevboard();
  $("devboard").hidden = false;
  document.body.dataset.mode = "developer";
  $("dev-full").setAttribute("aria-pressed", "true");
}
function exitDeveloper(): void {
  $("devboard").hidden = true;
  document.body.dataset.mode = "device";
  $("dev-full").setAttribute("aria-pressed", "false");
}

// ---------- theme ----------
function setTheme(theme: "dark" | "light"): void {
  state.theme = theme;
  state.themeChanges += 1;
  document.documentElement.dataset.theme = theme;
  $("theme").textContent = `Theme: ${theme}`;
  $("theme").setAttribute("aria-pressed", String(theme === "light"));
  if (bridge && state.card.view) bridge.setHostContext(hostContext(state.card.view)); // -> ui/notifications/host-context-changed
}

// ---------- Play demo (SPEC §2 beats; fixed pacing for screen recording; new household each run) ----------
type BeatStep = { beat: number; label: string; say?: string; action?: "newSession" | "developer" };
const BEATS: BeatStep[] = [
  { beat: 1, label: "consent", say: "Alexa, open In Network." },
  { beat: 1, label: "consent", say: "Allow." },
  { beat: 2, label: "opening: three people, three plans", say: "Alexa, I need a gastroenterologist, an allergist for my five-year-old, and an orthopedist for my little one. He's under two." },
  { beat: 2, label: "opening: three people, three plans", say: "Yes." },
  { beat: 3, label: "checkup year around the routine", say: "Alexa, I've met my out-of-pocket max this year. I want a full checkup: primary care, OB-GYN, a dermatologist, a gastroenterologist and lab work. Book them all before my plan resets." },
  { beat: 3, label: "checkup year around the routine", say: "Yes." },
  { beat: 4, label: "new session: state kept", action: "newSession" },
  { beat: 4, label: "new session: state kept", say: "Alexa, what's left on my checkup plan?" },
  { beat: 5, label: "set aside before you call", say: "Alexa, find an orthopedist for my youngest. He's under two." },
  { beat: 6, label: "behind the scenes", action: "developer" },
];

async function typeInto(text: string): Promise<void> {
  const input = $("utterance") as HTMLInputElement;
  input.value = "";
  if (FAST) { input.value = text; return; }
  for (const ch of text) { input.value += ch; await sleep(26); }
  await sleep(300);
}
/** Verify hook (?hold=1): pause after a step until window.__release() is called. */
async function hold(name: string): Promise<void> {
  if (!HOLD) return;
  state.hold = name;
  document.body.dataset.hold = name;
  await new Promise<void>((resolve) => { (window as unknown as { __release: () => void }).__release = () => resolve(); });
  state.hold = "";
  document.body.dataset.hold = "";
}

async function playDemo(): Promise<void> {
  if (state.demo.running) return;
  state.demo = { running: true, beat: 0, done: false, runs: state.demo.runs + 1 };
  document.body.dataset.demo = "running";
  $("play-demo").setAttribute("disabled", "");
  try {
    await queue;
    await resetHousehold();
    if (!FAST) await sleep(900);
    let lastBeat = 0;
    for (const b of BEATS) {
      state.demo.beat = b.beat;
      state.beat = b.beat;
      document.body.dataset.beat = String(b.beat);
      if (b.beat !== lastBeat) { lastBeat = b.beat; try { hooks.__beatMark?.({ beat: b.beat, label: b.label }); } catch { /* recorder gone */ } }
      if (b.action === "newSession") { await newSession(); await sleep(FAST ? 30 : 1200); continue; }
      if (b.action === "developer") {
        await showDeveloper();
        await hold(`beat-${b.beat}-developer`);
        await sleep(FAST ? 50 : 7000);
        continue;
      }
      cue("mom", b.say!);
      await typeInto(b.say!);
      ($("utterance") as HTMLInputElement).value = "";
      const turn = await enqueue(b.say!, "demo");
      if (!turn) throw new Error(`no answer to "${b.say}"`);
      if (turn.isError) throw new Error(`error answer to "${b.say}": ${turn.speech}`);
      await hold(`beat-${b.beat}-${turn.view ?? "voice"}-${turn.n}`);
      const total = turn.seconds.reduce((a, x) => a + x, 0);
      await sleep(FAST ? 40 : Math.round(total * 1000) + 350 * (turn.parts.length - 1) + 900);
    }
    state.demo.done = true;
    document.body.dataset.demo = "done";
  } catch (err) {
    document.body.dataset.demo = "failed";
    state.errors.push(`demo failed: ${String(err)}`);
    void subtitles(null, [`Demo stopped: ${String(err)}`]);
  } finally {
    state.demo.running = false;
    $("play-demo").removeAttribute("disabled");
  }
}

// ---------- wiring ----------
$("say").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("utterance") as HTMLInputElement;
  const text = input.value;
  if (!text.trim()) return;
  input.value = "";
  void enqueue(text, "typed");
});
$("new-session").addEventListener("click", () => { void (queue = queue.then(() => newSession()).catch((err) => state.errors.push(String(err)))); });
$("reset-demo").addEventListener("click", () => { void (queue = queue.then(() => resetHousehold()).catch((err) => state.errors.push(String(err)))); });
$("play-demo").addEventListener("click", () => { void playDemo(); });
$("theme").addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));
$("dev-full").addEventListener("click", () => { if (document.body.dataset.mode === "developer") exitDeveloper(); else void showDeveloper(); });
$("theme").textContent = `Theme: ${state.theme}`;

type SR = new () => { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onerror: (e: unknown) => void; start: () => void };
const Speech = (window as unknown as { webkitSpeechRecognition?: SR; SpeechRecognition?: SR }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: SR }).webkitSpeechRecognition;
if (Speech) {
  $("mic").removeAttribute("disabled");
  $("mic").addEventListener("click", () => {
    const r = new Speech();
    r.lang = "en-US";
    r.interimResults = false;
    r.onresult = (e) => { const t = e.results[0][0].transcript; if (t) void enqueue(t, "voice"); };
    r.onerror = (e) => console.warn("[speech]", e);
    r.start();
  });
}

(window as unknown as { __hostApi: unknown }).__hostApi = { say: (t: string) => enqueue(t, "typed"), setTheme, showDeveloper, exitDeveloper, newSession, resetHousehold };

connect()
  .then(async () => { if (params.get("view") === "developer") await showDeveloper(); })
  .catch((err) => { $("protocol").textContent = "FAILED"; state.errors.push(`connect failed: ${String(err)}`); });

// InNetwork MCP App views (ui://innetwork/<view>.html). One bundle for all six files: the screen is chosen by
// structuredContent.card.view (the server may answer book_visit with the family-match card, a consent gate with the
// consent card). Layout and classes follow the reference screens design/screens/0N-*/screen.html; every string comes
// from the card and goes in with textContent only. Zoom (deviceClass echo-show-8 -> 1.667 on the 768x480 base
// canvas) and theme (data-theme) come from hostContext and follow host-context-changed. The host draws the app bar and
// the conversation band above this view. A tap on a button sends ui/message: the user's next turn.
import { App } from "@modelcontextprotocol/ext-apps";
import type { BookedCard, CardModel, CheckupYearCard, ConsentCard, FamilyMatchCard, FamilyRow, MemberColor, SetAsideCard, VisitPlanCard, WeekModel, WeekVisit } from "../server/cards.ts";

const SVGNS = "http://www.w3.org/2000/svg";
const ZOOM: Record<string, number> = { "echo-show-8": 1.667, "echo-show-15": 1.667 };
const CODE: Record<CardModel["view"], string> = { "family-match": "fm", "checkup-year": "cy", "visit-plan": "vp", booked: "bk", "set-aside": "sa", consent: "cs" };
const root = document.getElementById("root") as HTMLElement;
const html = document.documentElement;
const body = document.body;
let renders = 0;

const app = new App({ name: "innetwork-screens", version: "0.1.0" });

// ---------- DOM helpers (text only through textContent / text nodes) ----------
type Kid = Node | string | null | undefined | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(typeof k === "string" ? document.createTextNode(k) : k);
  return e;
}
function svg(tag: string, attrs: Record<string, string>, ...kids: SVGElement[]): SVGElement {
  const e = document.createElementNS(SVGNS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) e.append(k);
  return e;
}
const nb = (s: string) => s.replace(/ /g, " ");
const nw = (s: string) => el("span", "nw", s);
const dotSep = () => el("span", "dot", "·");
const minutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const clockAmPm = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
/** "a · b · c" -> a <dot> b <dot> c (the references space middle dots wider than a plain space). */
function dotted(s: string, wrapNumbers = false): Node[] {
  const out: Node[] = [];
  s.split(" · ").forEach((part, i) => {
    if (i) out.push(document.createTextNode(" "), dotSep(), document.createTextNode(" "));
    out.push(...(wrapNumbers ? keepNumbers(part) : [document.createTextNode(part)]));
  });
  return out;
}
/** Keeps percentages, "Dec 31"-style dates and clock times on one line. */
function keepNumbers(s: string): Node[] {
  const re = /(\d+%|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}|\d{1,2}:\d{2}(?: [AP]M)?)/g;
  const out: Node[] = [];
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push(document.createTextNode(s.slice(last, m.index)));
    out.push(nw(m[0]));
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push(document.createTextNode(s.slice(last)));
  return out;
}
/** Hyphenated words ("in-network", "drop-off") never break at the hyphen. */
function noBreakHyphenated(s: string): Node[] {
  const out: Node[] = [];
  let last = 0;
  for (const m of s.matchAll(/[A-Za-z]+-[A-Za-z]+/g)) {
    if (m.index! > last) out.push(document.createTextNode(s.slice(last, m.index)));
    out.push(el("span", "nobreak", m[0]));
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push(document.createTextNode(s.slice(last)));
  return out;
}
const SOFT: Record<string, string> = { Gastroenterology: "Gastro­enterology", Dermatology: "Derma­tology", Orthopedics: "Ortho­pedics", "Primary care": "Primary care" };
const soft = (s: string) => SOFT[s] ?? s;

// ---------- icons (inline SVG, no raster, no third-party marks) ----------
const checkPath = (d: string) => svg("path", { d });
const ICON = {
  fmCheck: () => svg("svg", { class: "check", viewBox: "0 0 24 24", "aria-label": "fits" }, checkPath("M3.6 12.8 L9.2 18.2 L20.4 6.6")),
  fmUnknown: () => svg("svg", { class: "check", viewBox: "0 0 24 24", "aria-label": "not confirmed" }, svg("circle", { class: "ring", cx: "12", cy: "12", r: "10" }), svg("path", { class: "q", d: "M9.2 9.3 a2.9 2.9 0 1 1 4.2 2.6 c-0.8 0.4 -1.3 1 -1.3 2 v0.5" }), svg("circle", { class: "pt", cx: "12.1", cy: "17.3", r: "1.2" })),
  arrowHead: () => svg("svg", { class: "arrow-head", viewBox: "0 0 8 11", "aria-hidden": "true" }, svg("path", { d: "M0.4 0.4 L7.7 5.5 L0.4 10.6 L2.2 5.5 Z" })),
  mic: () => svg("svg", { class: "mic", viewBox: "0 0 14 20", "aria-hidden": "true" }, svg("rect", { class: "cap", x: "4", y: "0.6", width: "6", height: "11.4", rx: "3" }), svg("path", { class: "arm", d: "M1.2 8.6 C1.2 12.4 3.6 14.6 7 14.6 C10.4 14.6 12.8 12.4 12.8 8.6 M7 14.6 V18.6 M3.8 18.8 H10.2" })),
  booked: () => svg("svg", { viewBox: "0 0 12 12", "aria-hidden": "true" }, checkPath("M2.1 6.3 4.8 9 9.9 3.1")),
  cyOk: () => svg("svg", { class: "st-icon ok", viewBox: "0 0 16 16", "aria-hidden": "true" }, checkPath("M3 8.6 L6.4 11.8 L13 4.6")),
  cyUnknown: () => svg("svg", { class: "st-icon unk", viewBox: "0 0 16 16", "aria-hidden": "true" }, svg("circle", { class: "ring", cx: "8", cy: "8", r: "7.2" }), svg("path", { d: "M6 6.1 a2.05 2.05 0 1 1 2.9 1.85 c-0.6 0.3 -0.9 0.75 -0.9 1.4 v0.45" }), svg("circle", { class: "pt", cx: "8", cy: "11.7", r: "0.95" })),
  vpCheck: () => svg("svg", { viewBox: "0 0 12 12", "aria-hidden": "true" }, svg("path", { d: "M2.1 6.3 4.8 9 9.9 3.1", fill: "none", stroke: "var(--fits)", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round" })),
  vpLab: () => svg("svg", { viewBox: "0 0 18 18", "aria-hidden": "true" }, svg("circle", { cx: "9", cy: "9", r: "8.2", fill: "none", stroke: "var(--unknown)", "stroke-width": "1.2" }), svg("path", { d: "M6.9 7 a2.15 2.15 0 1 1 3.1 1.95 c-0.65 0.32 -1 0.8 -1 1.5 v0.4", fill: "none", stroke: "var(--unknown)", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round" }), svg("circle", { cx: "9", cy: "12.9", r: "1", fill: "var(--unknown)" })),
  vpVoice: () => svg("svg", { viewBox: "0 0 20.3 15.5", "aria-hidden": "true", fill: "var(--text-1)" },
    svg("rect", { x: "0", y: "5.1", width: "2.4", height: "5.3", rx: "1.2" }), svg("rect", { x: "4.4", y: "3.15", width: "2.4", height: "9.2", rx: "1.2" }), svg("rect", { x: "8.95", y: "0", width: "2.4", height: "15.5", rx: "1.2" }),
    svg("rect", { x: "13.5", y: "3.15", width: "2.4", height: "9.2", rx: "1.2" }), svg("rect", { x: "17.9", y: "5.1", width: "2.4", height: "5.3", rx: "1.2" })),
  bkCheck: () => svg("svg", { class: "title-check", viewBox: "0 0 32 27", "aria-label": "booked" }, checkPath("M3.4 15 L11.1 23.2 L29.1 2.9")),
  bkDoc: () => svg("svg", { viewBox: "0 0 42 51", width: "20.3", height: "24.7", "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": "3.7", "stroke-linecap": "round", "stroke-linejoin": "round" },
    svg("path", { d: "M9 2.2 H30 L40.6 13 V42.2 a6.7 6.7 0 0 1 -6.7 6.7 H8.9 a6.7 6.7 0 0 1 -6.7 -6.7 V8.9 a6.7 6.7 0 0 1 6.7 -6.7 Z" }), svg("path", { d: "M29.5 3 V13.6 H40" }), svg("path", { d: "M13 18.3 H23.3 M13 27.5 H31.5 M13 37 H23.3" })),
  bkMic: () => svg("svg", { viewBox: "0 0 41 58", width: "19.9", height: "28.1", "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": "3.7", "stroke-linecap": "round", "stroke-linejoin": "round" },
    svg("rect", { x: "12.1", y: "2.7", width: "17", height: "32.9", rx: "8.5" }), svg("path", { d: "M2.05 26 A18.55 18.55 0 0 0 39.15 26" }), svg("path", { d: "M20.6 43.2 V55 M11 56.3 H29.7" })),
  saCheck: () => svg("svg", { viewBox: "0 0 16 16", "aria-hidden": "true" }, checkPath("M3 8.6l3.2 3.1L13 4.6")),
  saUnknown: () => svg("svg", { class: "aside-row__q", viewBox: "0 0 20 20", role: "img", "aria-label": "unknown" }, svg("circle", { class: "ring", cx: "10", cy: "10", r: "9" }), svg("path", { d: "M7.6 7.7a2.45 2.45 0 1 1 3.7 2.1c-.8.45-1.3.95-1.3 1.9" }), svg("circle", { class: "pt", cx: "10", cy: "14.6", r: "1.05" })),
};
const CONSENT_ICON: Record<ConsentCard["lines"][number]["icon"], () => SVGElement> = {
  family: () => svg("svg", { viewBox: "0 0 24 24" }, svg("circle", { cx: "12", cy: "7.8", r: "2.8" }), svg("path", { d: "M6.6 18.6A5.4 5.4 0 0 1 17.4 18.6" }), svg("circle", { cx: "4.7", cy: "10.2", r: "2.1" }), svg("path", { d: "M1 18.6A3.7 3.7 0 0 1 7.3 16" }), svg("circle", { cx: "19.3", cy: "10.2", r: "2.1" }), svg("path", { d: "M23 18.6A3.7 3.7 0 0 0 16.7 16" }), svg("path", { d: "M1 18.6H23" })),
  calendar: () => svg("svg", { viewBox: "0 0 24 24" }, svg("rect", { x: "1.9", y: "4.5", width: "20.2", height: "18", rx: "3" }), svg("path", { d: "M1.9 9.6H22.1" }), svg("path", { d: "M7.4 1.4V6.4M16.6 1.4V6.4" })),
  note: () => svg("svg", { viewBox: "0 0 24 24" }, svg("path", { d: "M5.2 1.2H15.6L21.2 6.8V20.6A2.2 2.2 0 0 1 19 22.8H5A2.2 2.2 0 0 1 2.8 20.6V3.4A2.2 2.2 0 0 1 5 1.2Z" }), svg("path", { d: "M15.6 1.2V4.6A2.2 2.2 0 0 0 17.8 6.8H21.2" }), svg("path", { d: "M7.2 10.6H16.4M7.2 14.1H16.4M7.2 17.6H16.4" })),
  lock: () => svg("svg", { viewBox: "0 0 24 24" }, svg("rect", { x: "4", y: "10.5", width: "16", height: "11.8", rx: "2.2" }), svg("path", { d: "M7.6 10.5V6.6A4.4 4.4 0 0 1 16.4 6.6V10.5" }), svg("ellipse", { class: "dot", cx: "12", cy: "16.3", rx: "1", ry: "1.5" })),
  chat: () => svg("svg", { viewBox: "0 0 24 24" }, svg("path", { d: "M12.3 2.4C18.1 2.4 22.6 6.1 22.6 10.6C22.6 15.1 18.1 18.8 12.3 18.8C11 18.8 9.8 18.6 8.7 18.3L2.8 21L4.4 16.2C2.8 14.7 2 12.8 2 10.6C2 6.1 6.5 2.4 12.3 2.4Z" }), svg("circle", { class: "dot", cx: "8", cy: "10.6", r: "1.3" }), svg("circle", { class: "dot", cx: "12.3", cy: "10.6", r: "1.3" }), svg("circle", { class: "dot", cx: "16.6", cy: "10.6", r: "1.3" })),
};
const bookedTag = (word: string) => el("span", "booked-tag", ICON.booked(), word);
const BOOKED_WORD = "Booked"; // SPEC §2: rows get "Booked" after the yes

// ---------- 01 family match ----------
function familyMatch(c: FamilyMatchCard): Node[] {
  const lanes = el("ol", "lanes");
  for (const r of c.rows) lanes.append(lane(r));
  const footer = el("div", "footer-row", el("p", "routine-note", c.footnote ?? ""));
  if (c.prompt) footer.append(el("div", "voice-pill", ICON.mic(), el("span", "voice-text", c.prompt)));
  footer.querySelector(".voice-pill")?.setAttribute("role", "note");
  return [el("h1", "screen-title", c.title), lanes, footer];
}
function lane(r: FamilyRow): HTMLElement {
  const li = el("li", `lane lane--${r.member}`);
  const person = el("p", "person-text", el("span", "person-name", r.memberLabel));
  if (r.ageLabel) person.append(" ", el("span", "person-age", `(${nb(r.ageLabel)})`));
  person.append(` · ${nb(r.planLabel)} · ${r.specialty}`);
  li.append(el("div", "person", person));

  const flow = el("div", "flow");
  const arrow = (k: string) => el("span", `arrow arrow--${k}`, el("span", "arrow-shaft"), ICON.arrowHead());
  const cards = [...r.setAside.map((x) => ({ ...x, ask: false })), ...r.askOffice.map((x) => ({ ...x, ask: true }))].slice(0, 2);
  if (!cards.length) flow.append(arrow("long"));
  cards.forEach((x, i) => {
    flow.append(arrow(i === 0 ? "a" : "b"));
    const card = el("div", `aside-card aside-card--${i + 1}${x.ask ? " aside-card--ask" : ""}`, el("p", "aside-name", x.name), el("p", "aside-reason", x.reason));
    flow.append(card);
  });
  if (cards.length === 1) flow.append(arrow("long"));
  if (cards.length === 2) flow.append(arrow("c"));
  li.append(flow);

  const doc = el("article", "doctor");
  if (r.fit) {
    const detail = el("p", "doctor-detail");
    const segs = r.fit.detail.split(" · ");
    segs.forEach((s, i) => { if (i) detail.append(" "); detail.append(el("span", "seg", i < segs.length - 1 ? `${s} ·` : s)); });
    const bodyEl = el("div", "doctor-body", el("p", "doctor-name", r.fit.name), detail);
    if (r.fit.note) bodyEl.append(el("p", "note-chip", `Your note: "${r.fit.note}"`));
    bodyEl.append(el("p", "doctor-time", r.fit.when));
    if (r.fit.booked) bodyEl.append(el("p", "booked-line", bookedTag(BOOKED_WORD)));
    doc.append(ICON.fmCheck(), bodyEl);
  } else {
    doc.append(ICON.fmUnknown(), el("div", "doctor-body", el("p", "doctor-detail", r.none ?? "")));
  }
  li.append(doc);
  return li;
}

// ---------- 02 checkup year ----------
function checkupYear(c: CheckupYearCard): Node[] {
  const head = el("section", "plan-head", el("h1", "plan-title", c.title), el("div", "plan-sub", ...dotted(c.subtitle, true)), el("div", "plan-source", ...dotted(c.source)));
  const list = el("ul", "plan-list");
  list.setAttribute("aria-label", "Checkup plan");
  for (const it of c.items) {
    const li = el("li", "plan-row");
    li.style.setProperty("--who", `var(--${it.member})`);
    const status = el("span", "status");
    const m = it.text.match(/^(Booked)\s+(.+)$/);
    if (m) status.append(el("b", null, m[1]), " ", nw(m[2]));
    else status.append(el("b", null, it.text));
    if (it.detail) status.append(" ", el("span", "note", dotSep(), ` ${it.detail}`));
    li.append(el("span", "who-bar"), el("span", "who", it.memberLabel), el("span", "spec", it.item), it.status === "booked" || it.status === "booked_earlier" ? ICON.cyOk() : ICON.cyUnknown(), status);
    list.append(li);
  }
  return [head, list, weekStrip(c.week)];
}
function weekStrip(w: WeekModel): HTMLElement {
  const sec = el("section", "week");
  sec.setAttribute("aria-label", `Week of ${w.days[0]?.date ?? ""}`);
  const routine = [...w.routine].sort((a, b) => minutes(a.start) - minutes(b.start));
  const drop = routine[0], pick = routine[1];
  // axis: the hour each row ends in (drop-off, the window, pick-up)
  const axis = el("div", "axis");
  axis.style.gridRow = "4 / 9";
  const hourOf = (hhmm: string | undefined) => (hhmm ? String(Math.floor(minutes(hhmm) / 60) % 12 || 12) : "");
  [[9, hourOf(drop?.end)], [59, hourOf(w.window?.end)], [83, hourOf(pick?.end)]].forEach(([top, label]) => {
    if (!label) return;
    const s = el("span", null, String(label));
    s.style.top = `${top}px`;
    axis.append(s);
  });
  sec.append(axis);
  const mine = (key: string) => w.visits.filter((v) => v.dayKey === key && v.state !== "other_member");
  const labelDay = Math.max(0, w.days.findIndex((d) => mine(d.key).length === 0));
  w.days.forEach((d, i) => {
    const col = String(i + 2);
    const mon = i === 0;
    const name = el("div", `day-name${mon ? " mon" : ""}`, d.label);
    name.style.gridColumn = mon ? "1 / 3" : col;
    sec.append(name);
    const weekday = i + 1;
    const block = (b: typeof drop | undefined, cls: string) => {
      const div = el("div", `blk${mon ? " mon" : ""} routine ${cls}`);
      div.style.gridColumn = col;
      if (!b || !b.days.includes(weekday)) div.style.background = "transparent";
      else if (mon) div.append(el("div", "lbl", el("span", null, b.label), el("span", null, b.timeLabel)));
      return div;
    };
    sec.append(block(drop, "r-drop"));
    const win = el("div", `blk${mon ? " mon" : ""} r-win`);
    win.style.gridColumn = col;
    const visits = mine(d.key);
    if (i === labelDay && !visits.length && w.window) {
      const [a, b] = splitOnce(w.window.label, " · ");
      win.append(el("div", "lbl", el("span", "nw", b ? `${a} ·` : a), " ", b ? el("span", null, b) : null));
    }
    for (const v of visits) win.append(el("div", `visit${visits.length === 1 ? " solo" : ""}`, v.label));
    sec.append(win);
    sec.append(block(pick, "r-pick"));
  });
  for (const left of [154.4, 297.7, 441.5, 585.3]) { const s = el("i", "sep"); s.style.left = `${left}px`; sec.append(s); }
  return sec;
}
const splitOnce = (s: string, sep: string): [string, string | null] => { const i = s.indexOf(sep); return i < 0 ? [s, null] : [s.slice(0, i), s.slice(i + sep.length)]; };

// ---------- 03 visit plan ----------
function visitPlan(c: VisitPlanCard): Node[] {
  const w = c.week;
  const h0 = minutes(w.hours.start), h1 = minutes(w.hours.end);
  const n = Math.round((h1 - h0) / 30);
  const cal = el("section", "cal");
  cal.setAttribute("aria-label", `Week ${w.days[0]?.date ?? ""} to ${w.days.at(-1)?.date ?? ""}`);
  const lines = el("div", "cal-lines"), axis = el("div", "cal-axis");
  lines.setAttribute("aria-hidden", "true");
  for (let i = 0; i <= n; i++) {
    const ln = el("i"); ln.style.setProperty("--n", String(i)); lines.append(ln);
    const ax = el("span", "ax", clockAmPm(h0 + i * 30)); ax.style.setProperty("--n", String(i)); axis.append(ax);
  }
  const head = el("div", "cal-head");
  for (const d of w.days) head.append(el("div", "day", el("span", null, d.weekday), el("span", null, d.date)));
  cal.append(lines, axis, head);
  if (w.window) {
    const band = el("div", "band", el("span", "band-label", w.window.label));
    band.dataset.layer = "backdrop"; // the free window behind the visits, not a card
    band.style.setProperty("--ws", String(minutes(w.window.start) - h0));
    band.style.setProperty("--wl", String(minutes(w.window.end) - minutes(w.window.start)));
    cal.append(band);
  }
  const cols = el("div", "cal-cols");
  const tagFor = (v: WeekVisit) => (v.state === "booked_earlier" ? c.doctors.find((d) => d.specialty === v.label && d.tag)?.tag ?? null : null);
  w.days.forEach((d, i) => {
    const col = el("div", "col");
    col.dataset.day = d.weekday;
    for (const b of w.routine) {
      if (!b.days.includes(i + 1)) continue;
      const ev = el("div", `ev routine${i === 0 ? " labelled" : ""}`);
      ev.style.setProperty("--m", String(minutes(b.start) - h0));
      if (i === 0) ev.append(el("b", null, b.label), el("span", null, b.timeLabel));
      col.append(ev);
    }
    for (const v of w.visits.filter((x) => x.dayKey === d.key)) {
      const ev = el("div");
      ev.style.setProperty("--m", String(minutes(v.start) - h0));
      if (v.state === "other_member") {
        ev.className = `ev kid ${v.member}`;
        const field = v.label.startsWith(`${v.memberLabel} · `) ? v.label.slice(v.memberLabel.length + 3) : v.label;
        ev.append(el("span", "t", v.timeLabel), el("span", "n", el("b", null, v.memberLabel), ` · ${field}`));
      } else {
        ev.className = "ev visit";
        const long = v.label.length > 13;
        ev.append(el("span", "t", v.timeLabel), el("span", long ? "n" : "n one", long ? soft(v.label) : v.label));
        const tag = tagFor(v);
        if (tag) ev.append(el("span", "tag", tag));
      }
      col.append(ev);
    }
    cols.append(col);
  });
  cal.append(cols);

  const docs = el("aside", "docs");
  docs.setAttribute("aria-label", "Doctors");
  for (const d of c.doctors) {
    const when = el("div", "doc-when", el("span", null, d.when));
    if (d.tag) when.append(el("span", "tag", d.tag));
    const segs = d.detail.split(" · ");
    const facts = el("span");
    segs.forEach((s, i) => { if (i) facts.append(" "); facts.append(el("span", "f", i < segs.length - 1 ? `${s} ·` : s)); });
    docs.append(el("article", d.quiet ? "doc quiet" : "doc", el("p", "doc-title", el("b", null, d.specialty), el("span", null, ` · ${d.name}`)), when, el("p", "doc-facts", ICON.vpCheck(), facts)));
  }
  if (c.sourceLine) docs.append(el("p", "src", c.sourceLine));

  const out: Node[] = [el("h1", "title", c.title), el("main", "main", cal, docs)];
  if (c.lab) {
    const [a, b] = splitOnce(c.lab, " — ");
    const lab = el("div", "lab", ICON.vpLab(), el("p", null, el("b", null, a), b ? ` — ${b}` : null));
    lab.setAttribute("role", "note");
    out.push(lab);
  }
  if (c.prompt) { const v = el("div", "voice", ICON.vpVoice(), el("p", null, c.prompt)); v.setAttribute("role", "note"); out.push(v); }
  return out;
}

// ---------- 04 booked ----------
function booked(c: BookedCard): Node[] {
  const title = el("h1", "title", el("span", "title-text", c.title));
  if (c.list.some((l) => !l.earlier)) title.append(ICON.bkCheck());
  const hero = el("section", "hero", title, el("p", "subtitle", c.subtitle ?? ""));
  const list = el("ul", "visit-list");
  for (const l of c.list) {
    const [date, time] = splitOnce(l.when, " · ");
    const text = el("span", "visit-text", nw(date), ...(time ? [" · ", nw(time)] : []), " · ", el("span", null, l.label));
    if (l.earlier) text.append(" · ", el("span", "visit-note", "booked earlier"));
    list.append(el("li", `visit${l.earlier ? " visit--earlier" : ""}${l.member !== "mom" ? ` visit--${l.member}` : ""}`, el("span", "dot"), text));
  }
  const visits = el("section", "card visits", list);
  visits.setAttribute("aria-label", "Booked visits");
  const cards = el("div", "cards", visits);
  if (c.week) cards.append(compactWeek(c.week));
  const out: Node[] = [hero, cards];
  c.notices.forEach((n, i) => {
    out.push(el("section", `card band ${i === 0 ? "band--sent" : "band--cancel"}`, el("span", "band-icon", n.icon === "doc" ? ICON.bkDoc() : ICON.bkMic()), el("span", "band-text", n.text)));
  });
  return out;
}
function compactWeek(w: WeekModel): HTMLElement {
  const sec = el("section", "card week");
  sec.setAttribute("aria-label", `Week ${w.days[0]?.label ?? ""} to ${w.days.at(-1)?.label ?? ""}`);
  const grid = el("div", "week-grid");
  const routine = [...w.routine].sort((a, b) => minutes(a.start) - minutes(b.start));
  const ws = w.window ? minutes(w.window.start) : 510, wl = w.window ? minutes(w.window.end) - ws : 165;
  w.days.forEach((d, i) => {
    const day = el("div", "day", el("div", "day-head", el("span", null, d.weekday), el("span", null, d.date)));
    const slot = (b: (typeof routine)[number] | undefined) => {
      const s = el("div", "slot slot--routine");
      if (!b || !b.days.includes(i + 1)) s.style.background = "transparent";
      else if (i === 0) {
        const [first, last] = [b.label.slice(0, b.label.lastIndexOf(" ") + 1), b.label.slice(b.label.lastIndexOf(" ") + 1)];
        s.append(el("div", "routine-label", first, el("span", null, last), el("span", "time", b.timeLabel)));
      }
      return s;
    };
    const win = el("div", "slot slot--window");
    let prevTop = -Infinity;
    for (const v of w.visits.filter((x) => x.dayKey === d.key && x.state !== "other_member").sort((a, b) => minutes(a.start) - minutes(b.start))) {
      // position by time inside the window (45 base px for the window's length), stacked when two are close
      let top = Math.max(0, Math.min(45 - 18, ((minutes(v.start) - ws) * 45) / wl - 3.7));
      if (top < prevTop + 20.3) top = prevTop + 20.3;
      prevTop = top;
      const chip = el("span", "chip", v.timeLabel);
      chip.style.top = `${Math.round(top * 10) / 10}px`;
      win.append(chip);
    }
    day.append(slot(routine[0]), win, slot(routine[1]));
    grid.append(day);
  });
  sec.append(grid);
  return sec;
}

// ---------- 05 set aside ----------
function setAside(c: SetAsideCard): Node[] {
  const tab = el("span", "topic__tab");
  tab.setAttribute("aria-hidden", "true");
  const topic = el("h1", "topic", tab, el("span", "topic__title", el("b", null, c.heading.specialty), ` · ${c.heading.forWhom} · ${c.heading.plan}`));
  topic.style.setProperty("--who", `var(--${c.heading.member})`);
  const out: Node[] = [topic];
  if (c.fits.length) {
    out.push(el("h2", "section-title section-title--fits", c.fitsTitle));
    const grid = el("div", "fits-grid");
    for (const f of c.fits) {
      const checks = el("ul", "doc-card__checks");
      for (const ch of f.checks) checks.append(el("li", "check-line", ICON.saCheck(), el("span", null, ch)));
      const card = el("article", "doc-card", el("h3", "doc-card__name", f.name), el("p", "doc-card__spec", f.specialtyLabel), checks, el("hr", "doc-card__rule"));
      if (f.when) {
        const [date, time] = splitOnce(f.when, " · ");
        const slot = el("p", "doc-card__slot", date, ...(time ? [" ", dotSep(), " ", time] : []));
        if (f.booked) slot.append(bookedTag(BOOKED_WORD));
        card.append(slot);
      }
      grid.append(card);
    }
    out.push(grid);
  }
  if (c.setAside.length) {
    out.push(el("h2", "section-title section-title--aside", c.setAsideTitle));
    const list = el("ul", "aside-list");
    for (const x of c.setAside) {
      const unknown = x.kind === "ask_office" || x.kind === "not_confirmed";
      const who = el("span", "aside-row__who", unknown ? ICON.saUnknown() : null, el("span", "aside-row__name", x.name));
      const sep = el("span", "aside-row__sep");
      sep.setAttribute("aria-hidden", "true");
      list.append(el("li", `aside-row ${unknown ? "aside-row--unknown" : "aside-row--struck"}`, who, sep, el("span", "aside-row__reason", ...dotted(x.reason))));
    }
    out.push(list);
  }
  if (c.footer) out.push(el("p", "foot-note", c.footer));
  return out;
}

// ---------- 06 before we start ----------
function consent(c: ConsentCard): Node[] {
  const list = el("ul", "promises");
  c.lines.forEach((l, i) => {
    const icon = el("span", `promise-icon icon-${l.icon}`, CONSENT_ICON[l.icon]());
    icon.setAttribute("aria-hidden", "true");
    list.append(el("li", `promise${i === 0 ? " promise--tall" : ""}`, icon, el("p", "promise-text", ...noBreakHyphenated(l.text))));
  });
  const actions = el("div", "actions");
  for (const a of c.actions) {
    const b = el("button", `btn ${a.style === "primary" ? "btn-allow" : "btn-later"}`, a.label);
    b.type = "button";
    b.dataset.message = a.message;
    if (c.state !== "ask") {
      b.disabled = true;
      b.setAttribute("aria-pressed", String((c.state === "granted") === (a.style === "primary")));
    }
    b.addEventListener("click", () => void say(a.message, actions));
    actions.append(b);
  }
  return [el("main", "consent-card", el("h1", "consent-title", c.title), list, el("p", "disclaimer", c.disclaimer), actions)];
}
async function say(message: string, group: HTMLElement): Promise<void> {
  const buttons = [...group.querySelectorAll("button")];
  buttons.forEach((b) => (b.disabled = true));
  try {
    const r = await app.sendMessage({ role: "user", content: [{ type: "text", text: message }] });
    if (r.isError) buttons.forEach((b) => (b.disabled = false));
  } catch (e) {
    console.error("[view] sendMessage failed", e);
    buttons.forEach((b) => (b.disabled = false));
  }
}

// ---------- render, zoom, theme ----------
function render(card: CardModel): void {
  const code = CODE[card.view];
  if (!code) { root.className = "scr"; root.replaceChildren(el("p", "empty", "")); return; }
  root.className = `scr s-${code}`;
  root.dataset.screen = card.view;
  const nodes = card.view === "family-match" ? familyMatch(card)
    : card.view === "checkup-year" ? checkupYear(card)
    : card.view === "visit-plan" ? visitPlan(card)
    : card.view === "booked" ? booked(card)
    : card.view === "set-aside" ? setAside(card)
    : consent(card);
  root.replaceChildren(...nodes);
  renders += 1;
  body.dataset.view = card.view;
  body.dataset.rendered = String(renders);
  fit();
}

let deviceZoom = 1;
let availHeight = Infinity; // device px, from containerDimensions
/** Device-class zoom; reduced only if the content would not fit the container height (long data). */
function fit(): void {
  let z = deviceZoom;
  html.style.setProperty("zoom", String(z));
  if (Number.isFinite(availHeight)) {
    for (let i = 0; i < 4; i++) {
      const need = root.scrollHeight * z;
      if (need <= availHeight + 1) break;
      z = Math.max(deviceZoom * 0.85, Math.floor(z * (availHeight / need) * 1000) / 1000);
      html.style.setProperty("zoom", String(z));
    }
  }
  body.dataset.zoom = String(z);
}
type Ctx = { theme?: unknown; deviceClass?: unknown; containerDimensions?: { height?: number; maxHeight?: number; width?: number; maxWidth?: number }; displayMode?: unknown };
function applyHostContext(ctx: Ctx | undefined): void {
  if (!ctx) return;
  const theme = ctx.theme === "light" ? "light" : "dark"; // any other value: dark (STYLE §1.4)
  html.dataset.theme = theme;
  const dc = typeof ctx.deviceClass === "string" ? ctx.deviceClass : "";
  const dims = ctx.containerDimensions ?? {};
  const width = dims.width ?? dims.maxWidth;
  if (dc && ZOOM[dc]) deviceZoom = ZOOM[dc];
  else {
    deviceZoom = typeof width === "number" && width > 0 ? width / 768 : 1;
    console.warn(`[view] hostContext deviceClass "${dc || "(none)"}" unknown; zoom from width ${width ?? "?"}`);
  }
  const h = dims.height ?? dims.maxHeight;
  availHeight = typeof h === "number" && h > 0 ? h : Infinity;
  html.className = `dc-${dc || "unknown"} theme-${theme}`;
  body.dataset.theme = theme;
  body.dataset.deviceClass = dc;
  body.dataset.displayMode = typeof ctx.displayMode === "string" ? ctx.displayMode : "";
  fit();
}

app.ontoolinput = () => { /* the card arrives with the result */ };
app.ontoolresult = (result) => {
  const card = (result.structuredContent as { card?: CardModel | null } | undefined)?.card;
  if (!card) return;
  render(card);
  document.fonts?.ready.then(() => { fit(); body.dataset.fonts = document.fonts.check("700 16px Nunito") ? "nunito" : "fallback"; });
};
app.onhostcontextchanged = (p) => applyHostContext({ ...(app.getHostContext() as Ctx | undefined), ...(p as Ctx) });
app.onerror = (e) => console.error("[view]", e);
app.connect().then(() => {
  applyHostContext(app.getHostContext() as Ctx | undefined);
  body.dataset.connected = "1";
});

export type { MemberColor };

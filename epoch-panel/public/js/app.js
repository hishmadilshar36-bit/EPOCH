// Epoch panel frontend (vanilla JS). All text from the server is inserted with textContent.
const $ = (id) => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k === "checked" || k === "selected" || k === "disabled") el[k] = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500); }

async function api(path, { method = "GET", body } = {}) {
  const opts = { method, headers: {} };
  if (method !== "GET") { opts.headers["X-Epoch-Request"] = "1"; }
  if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const r = await fetch("/api" + path, opts);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { location.replace("/"); throw new Error("Please sign in."); }
  if (r.status === 403 && j.code === "MUST_CHANGE_PASSWORD") { location.hash = "#account"; throw new Error(j.error); }
  if (!r.ok) throw new Error(j.error || "Something went wrong.");
  return j;
}
// Run an action, show errors as a toast, then optionally re-render
async function act(fn, okMsg, rerender = true) {
  try { await fn(); if (okMsg) toast(okMsg); if (rerender) await route(); }
  catch (e) { toast(e.message); }
}

// ---------- labels & formatting ----------
const STAGE = { NEW: "New", CONTACTED: "Contacted", INTERESTED: "Interested", QUOTED: "Quotation sent", FREE_TRIAL: "Free trial", ACTIVE: "Active subscriber", SOLD: "Sold (one-time)", LOST: "Lost" };
const DEAL = { SUBSCRIPTION: "Monthly subscription", ONE_TIME: "One-time sale (full price)" };
const TSTATUS = { TODO: "To do", DOING: "In progress", DONE: "Done" };
const SWSTATUS = { READY: "Ready to sell", IN_DEVELOPMENT: "In development", PAUSED: "Paused" };
const KIND = { FULL: "Full payment", INSTALLMENT: "Part payment", SETUP: "Setup fee", MONTHLY: "Monthly subscription", OTHER: "Other" };
const METHOD = { CASH: "Cash", BANK: "Bank transfer", CARD: "Card", OTHER: "Other" };
const PSTATUS = { PENDING: "Pending", PAID: "Paid" };
const money = (n) => "Rs. " + Math.round(Number(n) || 0).toLocaleString();
const ymd = (iso) => (iso ? String(iso).slice(0, 10) : "");
const fmtDate = (iso) => (iso ? new Date(ymd(iso) + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
function todayUTC() { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); }
const daysUntil = (iso) => Math.round((Date.parse(ymd(iso) + "T00:00:00Z") - todayUTC()) / 864e5);
function todayYMD() { return new Date(todayUTC()).toISOString().slice(0, 10); }
const options = (map, val) => Object.entries(map).map(([k, v]) => h("option", { value: k, selected: k === val }, v));
const userOptions = (val, { none = "Unassigned" } = {}) => [h("option", { value: "" }, none), ...S.users.filter((u) => u.active || u.id === val).map((u) => h("option", { value: u.id, selected: u.id === val }, u.name))];
function field(label, input, cls) { if (!input.id) input.id = "f" + Math.random().toString(36).slice(2, 8); return h("label", { class: "fld" + (cls ? " " + cls : ""), for: input.id }, label, input); }
function confirmBtn(label, onConfirm) {
  const b = h("button", { class: "btn danger small", type: "button" }, label);
  let armed = false, t;
  b.onclick = () => {
    if (!armed) { armed = true; b.textContent = "Yes, delete"; b.classList.add("sure"); t = setTimeout(() => { armed = false; b.textContent = label; b.classList.remove("sure"); }, 4000); return; }
    clearTimeout(t); onConfirm();
  };
  return b;
}
const numOrNull = (v) => (v === "" ? null : Number(v));
const isAdmin = () => S.me?.role === "ADMIN";
const S = { me: null, users: [], open: null };

// ---------- shell ----------
async function boot() {
  try { S.me = (await api("/me")).user; } catch { return; }
  $("meName").textContent = S.me.name;
  $("meRole").textContent = isAdmin() ? "· Admin" : "";
  document.querySelectorAll("[data-admin]").forEach((a) => (a.hidden = !isAdmin()));
  $("logout").onclick = async () => { await api("/logout", { method: "POST" }).catch(() => {}); location.replace("/"); };
  window.addEventListener("hashchange", () => { S.open = null; route(); });
  if (!location.hash) location.hash = S.me.mustChangePassword ? "#account" : "#me";
  else route();
}

const PAGES = { me: pageMe, dashboard: pageDashboard, tasks: pageTasks, customers: pageCustomers, software: pageSoftware, payments: pagePayments, payouts: pagePayouts, team: pageTeam, account: pageAccount };
const ADMIN_PAGES = ["payments", "payouts", "team"];
async function route() {
  let page = location.hash.slice(1) || "me";
  if (!PAGES[page] || (ADMIN_PAGES.includes(page) && !isAdmin())) page = "me";
  if (S.me.mustChangePassword) page = "account";
  document.querySelectorAll("#nav a").forEach((a) => a.toggleAttribute("aria-current", false) || (a.dataset.page === page && a.setAttribute("aria-current", "page")));
  const main = $("main");
  try {
    if (page !== "account") S.users = await api("/users");
    const scroll = window.scrollY;
    const el = await PAGES[page]();
    main.replaceChildren(el);
    window.scrollTo(0, scroll);
  } catch (e) {
    main.replaceChildren(h("div", { class: "error" }, e.message));
  }
}
const head = (title, sub, ...right) => h("div", { class: "page-head" }, h("div", {}, h("h1", {}, title), sub ? h("p", {}, sub) : null), right.length ? h("div", { class: "actions" }, right) : null);

// ---------- plan helpers ----------
function dayNum(start) { if (!start) return null; return Math.round((todayUTC() - Date.parse(start + "T00:00:00Z")) / 864e5) + 1; }
function phaseDates(p, start) {
  if (p.ongoing || !start) return p.ongoing ? "Alongside the plan" : "";
  const s = Date.parse(start + "T00:00:00Z"), f = (d) => new Date(s + (d - 1) * 864e5).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  return `${f(p.from)} – ${f(p.to)}`;
}
function trialAlerts(trials) {
  return trials.map((c) => {
    const left = c.trialEnds ? daysUntil(c.trialEnds) : null;
    const when = left == null ? "end date not set" : left < 0 ? `ended ${-left} days ago` : left === 0 ? "ends today" : `ends ${fmtDate(c.trialEnds)} (${left} day${left === 1 ? "" : "s"} left)`;
    return h("div", { class: "alert" }, h("div", {}, h("b", {}, "Free period: "), `${c.name}${c.software?.name || c.software ? ", " + (c.software?.name || c.software) : ""}, ${when}. Agree the paid package before it ends.`),
      h("a", { class: "btn small", href: "#customers" }, "Open customers"));
  });
}

// ---------- dashboard ----------
async function pageDashboard() {
  const [sum, plan, tasks] = await Promise.all([api("/summary"), api("/plan"), api("/tasks")]);
  const dn = dayNum(plan.start);
  const dayTxt = dn == null ? "Plan start date not set" : dn < 1 ? `The 30-day plan starts in ${1 - dn} day${1 - dn === 1 ? "" : "s"} (${fmtDate(plan.start)})` : dn > 30 ? "The 30-day plan is finished" : `Day ${dn} of the 30-day plan`;
  const root = h("div", { class: "stack" }, head(`Hello, ${S.me.name}`, dayTxt));
  if (plan.company) root.append(anniversaryCard(plan.company));
  root.append(...trialAlerts(sum.trials));
  if (sum.money) root.append(moneyKpis(sum.money));
  const pct = sum.tasks.total ? Math.round((sum.tasks.done / sum.tasks.total) * 100) : 0;
  root.append(h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "Team progress"), h("span", { class: "muted mono" }, `${sum.tasks.done}/${sum.tasks.total} tasks · ${pct}%`)),
    h("div", { class: "grid g3", style: "padding:12px" }, sum.people.map((p) => h("div", { class: "card person" },
      h("b", {}, p.name), h("span", { class: "muted", style: "font-size:12px" }, p.title || (p.role === "ADMIN" ? "Admin" : "Team member")),
      h("div", { class: "bar" }, h("b", { style: `width:${p.total ? (p.done / p.total) * 100 : 0}%` })),
      h("span", { class: "muted mono", style: "font-size:12px" }, `${p.done}/${p.total} done · ${p.doing} in progress`))))));
  const mine = tasks.filter((t) => t.assigneeId === S.me.id && t.status !== "DONE" && (t.phase === 0 || dn == null || plan.phases.find((p) => p.n === t.phase)?.from <= Math.max(dn, 1) + 2));
  root.append(h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "Your tasks now"), h("a", { href: "#tasks", class: "btn small" }, "Open task board")),
    mine.length ? h("ul", { class: "tasks", style: "border-top:0" }, mine.map((t) => taskRow(t, plan, { compact: true }))) : h("div", { class: "empty" }, "Nothing due right now.")));
  root.append(h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "Customer pipeline"), h("a", { href: "#customers", class: "btn small" }, "Open customers")),
    h("div", { class: "grid", style: "grid-template-columns:repeat(auto-fit,minmax(110px,1fr));padding:12px" },
      Object.entries(sum.pipeline).map(([k, v]) => h("div", { class: "kpi card" }, h("div", { class: "v mono" }, String(v)), h("div", { class: "l" }, STAGE[k]))))));
  return root;
}
// Company age and next anniversary, from the opening date (YYYY-MM-DD)
function anniversaryInfo(openedOn) {
  const [y, m, d] = openedOn.split("-").map(Number), today = todayUTC(), now = new Date(today);
  let next = Date.UTC(now.getUTCFullYear(), m - 1, d);
  if (next < today) next = Date.UTC(now.getUTCFullYear() + 1, m - 1, d);
  const nextYear = new Date(next).getUTCFullYear();
  let months = (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() - (m - 1));
  if (now.getUTCDate() < d) months--;
  return { years: Math.floor(months / 12), months: months % 12, next, number: nextYear - y, daysLeft: Math.round((next - today) / 864e5) };
}
const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
function anniversaryCard(company) {
  const a = anniversaryInfo(company.openedOn);
  const age = [a.years ? `${a.years} year${a.years === 1 ? "" : "s"}` : "", a.months ? `${a.months} month${a.months === 1 ? "" : "s"}` : ""].filter(Boolean).join(" ") || "less than a month";
  const nextTxt = a.daysLeft === 0 ? `Today is Epoch's ${ordinal(a.number)} anniversary. Happy anniversary!` : `${ordinal(a.number)} anniversary on ${fmtDate(new Date(a.next).toISOString())}, in ${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"}`;
  return h("div", { class: "card card-body anniv" + (a.daysLeft === 0 ? " today" : "") },
    h("div", {}, h("b", {}, `${company.name} opened on ${fmtDate(company.openedOn)}`), h("div", { class: "muted" }, `${age} in business`)),
    h("div", { class: "anniv-next mono" }, nextTxt));
}
const kpi = (v, l) => h("div", { class: "card kpi" }, h("div", { class: "v mono" }, v), h("div", { class: "l" }, l));
const moneyKpis = (m) => h("div", { class: "grid g4" },
  kpi(money(m.collected), "Collected from customers"), kpi(money(m.pending + m.unbilled), "Still to collect"),
  kpi(money(m.companyFund), "In the Epoch company fund"), kpi(money(m.unsplit), "Collected but not yet split"));
// Paid / due / not-yet-billed line for one customer (admin only data)
function moneyLine(c) {
  if (!c.money) return null;
  const { paid, pending, unbilled } = c.money;
  return h("div", { class: "money-line mono" }, h("span", { class: "paid" }, `Paid ${money(paid)}`), pending ? h("span", { class: "due" }, `Due ${money(pending)}`) : null,
    unbilled ? h("span", { class: "gap" }, `Not yet billed ${money(unbilled)}`) : null);
}
const priceText = (c) => c.dealType === "ONE_TIME" ? (c.totalPrice ? `${money(c.totalPrice)} one-time` : "One-time") : c.monthlyFee ? `${money(c.monthlyFee)} / month` : "—";

// ---------- task board ----------
const TF = { person: "", hideDone: false };
function canEditTask(t) { return isAdmin() || t.assigneeId === S.me.id; }
const nextStatus = (s) => ({ TODO: "DOING", DOING: "DONE", DONE: "TODO" })[s];

function taskRow(t, plan, { compact = false } = {}) {
  const open = S.open === "t" + t.id, can = canEditTask(t);
  const li = h("li", { class: "task" + (t.status === "DONE" ? " is-done" : "") });
  const phase = plan.phases.find((p) => p.n === t.phase);
  li.append(h("div", { class: "trow" },
    h("button", { class: "stbtn", "data-s": t.status, disabled: !can, title: can ? `${TSTATUS[t.status]} · click for ${TSTATUS[nextStatus(t.status)]}` : TSTATUS[t.status], "aria-label": `${t.title}: ${TSTATUS[t.status]}`,
      onclick: () => act(() => api(`/tasks/${t.id}`, { method: "PATCH", body: { status: nextStatus(t.status) } })) }),
    h("div", { class: "ttitle" }, t.title, compact && phase ? h("small", {}, phase.ongoing ? phase.title : `Days ${phase.from}–${phase.to} · ${phase.title}`) : t.status === "DOING" ? h("small", { style: "color:var(--warn)" }, "In progress" + (t.notes ? " · " + t.notes : "")) : t.notes ? h("small", {}, t.notes) : null),
    h("span", { class: "chip" + (t.assigneeId === S.me.id ? " mine" : "") }, t.assignee?.name || "Unassigned"),
    compact ? h("span") : h("button", { class: "more", "aria-expanded": String(open), "aria-label": "Details for " + t.title, onclick: () => { S.open = open ? null : "t" + t.id; route(); } }, open ? "▴" : "▾")));
  if (open && !compact) {
    const title = h("input", { value: t.title, disabled: !isAdmin() });
    const assignee = h("select", { disabled: !isAdmin() }, userOptions(t.assigneeId));
    const phaseSel = h("select", { disabled: !isAdmin() }, plan.phases.map((p) => h("option", { value: p.n, selected: p.n === t.phase }, p.ongoing ? p.title : `Days ${p.from}–${p.to}: ${p.title}`)));
    const status = h("select", { disabled: !can }, options(TSTATUS, t.status));
    const notes = h("textarea", { disabled: !can, placeholder: "Links, progress, who you spoke to…" }, t.notes);
    const save = () => {
      const body = { status: status.value, notes: notes.value };
      if (isAdmin()) Object.assign(body, { title: title.value, assigneeId: numOrNull(assignee.value), phase: Number(phaseSel.value) });
      act(() => api(`/tasks/${t.id}`, { method: "PATCH", body }), "Task saved");
    };
    li.append(h("div", { class: "tedit" }, h("div", { class: "form" },
      field("Task", title, "full"), field("Assigned to", assignee), field("Phase", phaseSel), field("Status", status), field("Notes", notes, "full"),
      h("div", { class: "actions full" },
        !can ? h("span", { class: "muted", style: "font-size:12px" }, "Only the assignee or the admin can change this task.") : null,
        isAdmin() ? confirmBtn("Delete", () => act(() => api(`/tasks/${t.id}`, { method: "DELETE" }), "Task deleted")) : null,
        can ? h("button", { class: "btn primary small", onclick: save }, "Save") : null))));
  }
  return li;
}

async function pageTasks() {
  const [plan, tasks] = await Promise.all([api("/plan"), api("/tasks")]);
  const dn = dayNum(plan.start);
  const startInput = h("input", { type: "date", class: "inp", value: plan.start || "", style: "width:auto", disabled: !isAdmin(), "aria-label": "Plan start date",
    onchange: (e) => act(() => api("/plan", { method: "PATCH", body: { start: e.target.value } }), "Start date saved") });
  const root = h("div", { class: "stack" }, head("Task board", dn == null ? "Set the plan start date to begin." : dn < 1 ? `Day 1 is ${fmtDate(plan.start)}. Starts in ${1 - dn} day${1 - dn === 1 ? "" : "s"}.` : dn > 30 ? "The 30 days are over." : `Day ${dn} of 30`,
    h("label", { class: "muted", style: "display:flex;gap:6px;align-items:center;font-size:13px" }, "Day 1:", startInput)));
  const track = h("div", { class: "track", "aria-hidden": "true" });
  for (let d = 1; d <= 30; d++) track.append(h("i", { class: dn != null && d < dn ? "past" : d === dn ? "today" : "", title: "Day " + d }));
  root.append(track);
  const person = h("select", { class: "inp", style: "width:auto", "aria-label": "Show tasks for", onchange: (e) => { TF.person = e.target.value; route(); } },
    h("option", { value: "" }, "Everyone"), h("option", { value: "me", selected: TF.person === "me" }, "Only mine"), S.users.map((u) => h("option", { value: String(u.id), selected: TF.person === String(u.id) }, u.name)), h("option", { value: "none", selected: TF.person === "none" }, "Unassigned"));
  person.value = TF.person;
  root.append(h("div", { class: "actions", style: "justify-content:flex-start" }, person,
    h("label", { style: "display:flex;gap:6px;align-items:center;color:var(--muted)" }, h("input", { type: "checkbox", checked: TF.hideDone, onchange: (e) => { TF.hideDone = e.target.checked; route(); } }), "Hide done")));
  const match = (t) => (!TF.person || (TF.person === "me" ? t.assigneeId === S.me.id : TF.person === "none" ? !t.assigneeId : String(t.assigneeId) === TF.person)) && (!TF.hideDone || t.status !== "DONE");
  for (const p of plan.phases) {
    const all = tasks.filter((t) => t.phase === p.n), done = all.filter((t) => t.status === "DONE").length, shown = all.filter(match);
    let st = "next", lbl = "Upcoming";
    if (all.length && done === all.length) { st = "done"; lbl = "Complete"; }
    else if (p.ongoing) { st = "now"; lbl = "Now"; }
    else if (dn != null && dn > p.to) { st = "behind"; lbl = "Behind"; }
    else if (dn != null && dn >= p.from) { st = "now"; lbl = "Now"; }
    const sec = h("section", { class: "card phase" + (st === "now" ? " now" : "") },
      h("div", { class: "ph-head" },
        h("div", { class: "ph-days" }, h("b", {}, p.ongoing ? "Ongoing" : `Days ${p.from}–${p.to}`), phaseDates(p, plan.start)),
        h("div", {}, h("h2", {}, p.title, h("span", { class: "pill " + st }, lbl)), h("div", { class: "ph-target" }, h("strong", {}, "Target: "), p.target), p.note ? h("div", { class: "ph-target" }, p.note) : null),
        h("div", { class: "mono", style: "text-align:right" }, `${done}/${all.length}`, h("div", { class: "muted", style: "font-size:12px" }, "done"))));
    sec.append(shown.length ? h("ul", { class: "tasks" }, shown.map((t) => taskRow(t, plan))) : h("div", { class: "empty", style: "border-top:1px solid var(--line)" }, all.length ? "No tasks match this filter." : "No tasks yet."));
    const title = h("input", { class: "inp", placeholder: isAdmin() ? `Add a task to ${p.title.toLowerCase()}` : "Add a task for yourself", "aria-label": "New task" });
    const who = isAdmin() ? h("select", { class: "inp", "aria-label": "Assign to" }, userOptions(TF.person && !["me", "none"].includes(TF.person) ? Number(TF.person) : null)) : h("span");
    const add = () => { if (!title.value.trim()) return title.focus(); act(() => api("/tasks", { method: "POST", body: { title: title.value, phase: p.n, assigneeId: isAdmin() ? numOrNull(who.value) : S.me.id } }), "Task added"); };
    title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    sec.append(h("div", { class: "addrow" }, title, who, h("button", { class: "btn primary", onclick: add }, "Add")));
    root.append(sec);
  }
  return root;
}

// ---------- customers ----------
async function pageCustomers() {
  const [customers, software] = await Promise.all([api("/customers"), api("/software")]);
  const swOptions = (val) => [h("option", { value: "" }, "Not chosen"), ...software.map((s) => h("option", { value: s.id, selected: s.id === val }, s.name))];
  const typeOpts = (val) => ["Shop", "Restaurant", "Salon", "Clinic", "Other"].map((t) => h("option", { value: t, selected: t === val }, t));
  const root = h("div", { class: "stack" }, head("Customers", "Leads, free trials and paying subscribers"));
  root.append(...trialAlerts(customers.filter((c) => c.stage === "FREE_TRIAL")));

  const f = { name: h("input", { placeholder: "e.g. Green Leaf Café" }), contact: h("input", { placeholder: "Owner or manager" }), phone: h("input", { placeholder: "Phone / WhatsApp" }),
    type: h("select", {}, typeOpts("Shop")), softwareId: h("select", {}, swOptions(null)), ownerId: h("select", {}, userOptions(S.users.find((u) => u.username === "hansa")?.id ?? S.me.id)), stage: h("select", {}, options(STAGE, "NEW")),
    dealType: h("select", {}, options(DEAL, "SUBSCRIPTION")), price: h("input", { type: "number", min: "0", step: "1000", placeholder: "0" }) };
  const priceLabel = h("span", {}, "Monthly fee (Rs.)");
  f.dealType.onchange = () => (priceLabel.textContent = f.dealType.value === "ONE_TIME" ? "Full price (Rs.)" : "Monthly fee (Rs.)");
  const addForm = h("form", { class: "card card-body form", onsubmit: (e) => { e.preventDefault(); if (!f.name.value.trim()) return f.name.focus();
    const price = Number(f.price.value) || 0, oneTime = f.dealType.value === "ONE_TIME";
    act(() => api("/customers", { method: "POST", body: { name: f.name.value, contact: f.contact.value, phone: f.phone.value, type: f.type.value, softwareId: numOrNull(f.softwareId.value), ownerId: numOrNull(f.ownerId.value), stage: f.stage.value, dealType: f.dealType.value, totalPrice: oneTime ? price : 0, monthlyFee: oneTime ? 0 : price } }), "Customer added"); } },
    field("Business name", f.name), field("Contact person", f.contact), field("Phone", f.phone), field("Type", f.type), field("Software", f.softwareId), field("Handled by", f.ownerId), field("Stage", f.stage),
    field("Deal", f.dealType), field(priceLabel, f.price),
    h("button", { class: "btn primary", type: "submit" }, "Add customer"));
  root.append(addForm);

  const tbody = h("tbody");
  for (const c of customers) {
    const open = S.open === "c" + c.id;
    tbody.append(h("tr", {},
      h("td", {}, h("b", {}, c.name), h("div", { class: "muted", style: "font-size:12px" }, [c.type, c.contact, c.phone].filter(Boolean).join(" · "))),
      h("td", {}, c.software?.name || "—"),
      h("td", {}, h("span", { class: "pill " + c.stage }, STAGE[c.stage])),
      h("td", {}, c.owner?.name || "—"),
      h("td", {}, h("div", { class: "mono" }, priceText(c)), moneyLine(c)),
      h("td", {}, c.stage === "FREE_TRIAL" && c.trialEnds ? `Free until ${fmtDate(c.trialEnds)}` : c.startedAt ? `Since ${fmtDate(c.startedAt)}` : ""),
      h("td", {}, h("button", { class: "btn small", onclick: () => { S.open = open ? null : "c" + c.id; route(); } }, open ? "Close" : "Edit"))));
    if (open) {
      const e = { name: h("input", { value: c.name }), contact: h("input", { value: c.contact }), phone: h("input", { value: c.phone }), type: h("select", {}, typeOpts(c.type)),
        softwareId: h("select", {}, swOptions(c.softwareId)), ownerId: h("select", {}, userOptions(c.ownerId)), stage: h("select", {}, options(STAGE, c.stage)),
        dealType: h("select", {}, options(DEAL, c.dealType)), totalPrice: h("input", { type: "number", min: "0", step: "1000", value: c.totalPrice }),
        monthlyFee: h("input", { type: "number", min: "0", step: "100", value: c.monthlyFee }), startedAt: h("input", { type: "date", value: ymd(c.startedAt) }), trialEnds: h("input", { type: "date", value: ymd(c.trialEnds) }),
        notes: h("textarea", {}, c.notes) };
      const save = () => act(() => api(`/customers/${c.id}`, { method: "PATCH", body: { name: e.name.value, contact: e.contact.value, phone: e.phone.value, type: e.type.value, softwareId: numOrNull(e.softwareId.value), ownerId: numOrNull(e.ownerId.value), stage: e.stage.value, dealType: e.dealType.value, totalPrice: Number(e.totalPrice.value) || 0, monthlyFee: Number(e.monthlyFee.value) || 0, startedAt: e.startedAt.value, trialEnds: e.trialEnds.value, notes: e.notes.value } }), "Customer saved");
      tbody.append(h("tr", {}, h("td", { colspan: "7", style: "background:var(--surface-2)" }, h("div", { class: "form" },
        field("Business name", e.name), field("Contact person", e.contact), field("Phone", e.phone), field("Type", e.type), field("Software", e.softwareId), field("Handled by", e.ownerId), field("Stage", e.stage),
        field("Deal", e.dealType), field("Full price (one-time, Rs.)", e.totalPrice), field("Monthly fee (subscription, Rs.)", e.monthlyFee), field("Customer since", e.startedAt), field("Free period ends", e.trialEnds), field("Notes", e.notes, "full"),
        h("div", { class: "actions full" }, isAdmin() ? confirmBtn("Delete customer", () => act(() => api(`/customers/${c.id}`, { method: "DELETE" }), "Customer deleted")) : null, h("button", { class: "btn primary small", onclick: save }, "Save"))))));
    }
  }
  root.append(h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, `All customers (${customers.length})`)),
    customers.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Business", "Software", "Stage", "Handled by", "Price", "Dates", ""].map((x) => h("th", {}, x)))), tbody))
      : h("div", { class: "empty" }, "No customers yet. Add the first one above.")));
  return root;
}

// ---------- software ----------
async function pageSoftware() {
  const software = await api("/software");
  const root = h("div", { class: "stack" }, head("Software", isAdmin() ? "Your products and who is responsible for each one" : "Our products and who is responsible for each one"));
  if (isAdmin()) {
    const n = h("input", { placeholder: "e.g. Hotel booking system" }), d = h("input", { placeholder: "Short description" }), s = h("select", {}, options(SWSTATUS, "READY"));
    root.append(h("form", { class: "card card-body form", onsubmit: (e) => { e.preventDefault(); if (!n.value.trim()) return n.focus(); act(() => api("/software", { method: "POST", body: { name: n.value, description: d.value, status: s.value } }), "Software added"); } },
      field("Software name", n), field("Description", d), field("Status", s), h("button", { class: "btn primary", type: "submit" }, "Add software")));
  }
  const grid = h("div", { class: "grid g2" });
  for (const sw of software) {
    const editing = S.open === "s" + sw.id;
    const card = h("div", { class: "card sw" }, h("div", { class: "card-head" }, h("h2", {}, sw.name), h("span", { class: "pill " + sw.status }, SWSTATUS[sw.status])));
    const body = h("div", { class: "card-body" });
    if (editing) {
      const n = h("input", { value: sw.name }), d = h("textarea", {}, sw.description), s = h("select", {}, options(SWSTATUS, sw.status));
      body.append(h("div", { class: "form" }, field("Name", n, "full"), field("Description", d, "full"), field("Status", s),
        h("div", { class: "actions full" }, confirmBtn("Delete", () => act(() => api(`/software/${sw.id}`, { method: "DELETE" }), "Software deleted")),
          h("button", { class: "btn small", onclick: () => { S.open = null; route(); } }, "Cancel"),
          h("button", { class: "btn primary small", onclick: () => act(async () => { await api(`/software/${sw.id}`, { method: "PATCH", body: { name: n.value, description: d.value, status: s.value } }); S.open = null; }, "Saved") }, "Save"))));
    } else {
      body.append(sw.description ? h("p", { style: "margin:0" }, sw.description) : null, h("div", { class: "muted", style: "font-size:12px" }, `${sw._count.customers} customer${sw._count.customers === 1 ? "" : "s"}`));
    }
    body.append(h("div", { class: "fld" }, "Assigned team", sw.assignments.length ? h("div", { class: "assign" }, sw.assignments.map((a) => h("span", { class: "chip" + (a.userId === S.me.id ? " mine" : "") }, `${a.user.name} · ${a.responsibility}`,
      isAdmin() ? h("button", { type: "button", "aria-label": `Remove ${a.user.name} as ${a.responsibility}`, title: "Remove", onclick: () => act(() => api(`/assignments/${a.id}`, { method: "DELETE" }), "Removed") }, "×") : null))) : h("span", {}, "Nobody assigned yet")));
    if (isAdmin()) {
      const u = h("select", { class: "inp", "aria-label": "Team member" }, S.users.filter((x) => x.active).map((x) => h("option", { value: x.id }, x.name)));
      const r = h("select", { class: "inp", "aria-label": "Responsibility" }, ["Development", "Design", "Sales", "Support", "Video"].map((x) => h("option", { value: x }, x)));
      body.append(h("div", { class: "actions", style: "justify-content:flex-start" }, u, r, h("button", { class: "btn small primary", onclick: () => act(() => api(`/software/${sw.id}/assignments`, { method: "POST", body: { userId: Number(u.value), responsibility: r.value } }), "Assigned") }, "Assign"),
        editing ? null : h("button", { class: "btn small", style: "margin-left:auto", onclick: () => { S.open = "s" + sw.id; route(); } }, "Edit")));
    }
    card.append(body); grid.append(card);
  }
  root.append(software.length ? grid : h("div", { class: "card empty" }, "No software yet."));
  return root;
}

// ---------- payments (admin) ----------
async function pagePayments() {
  const [payments, customers, sum] = await Promise.all([api("/payments"), api("/customers"), api("/summary")]);
  const root = h("div", { class: "stack" }, head("Customer payments", "Full payments, part payments and subscriptions. Only the admin can see this page."));
  root.append(moneyKpis(sum.money));
  const oneTime = customers.filter((c) => c.dealType === "ONE_TIME" && c.totalPrice);
  if (oneTime.length) {
    root.append(h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "One-time sales")),
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Customer", "Full price", "Paid", "Due (recorded)", "Not yet billed"].map((x, i) => h("th", { class: i ? "num" : "" }, x)))),
        h("tbody", {}, oneTime.map((c) => h("tr", {}, h("td", {}, h("b", {}, c.name), h("div", { class: "muted", style: "font-size:12px" }, c.software?.name || "")),
          h("td", { class: "num" }, money(c.totalPrice)), h("td", { class: "num", style: "color:var(--good)" }, money(c.money.paid)),
          h("td", { class: "num", style: "color:var(--warn)" }, money(c.money.pending)),
          h("td", { class: "num", style: c.money.unbilled ? "color:var(--bad)" : "" }, money(c.money.unbilled)))))))));
  }

  const monthLabel = new Date().toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  const active = customers.filter((c) => c.stage === "ACTIVE" && c.monthlyFee > 0);
  const missing = active.filter((c) => !payments.some((p) => p.customerId === c.id && p.kind === "MONTHLY" && p.period === monthLabel));
  root.append(h("div", { class: "card card-body actions", style: "justify-content:space-between" },
    h("span", {}, missing.length ? `${missing.length} active subscriber${missing.length === 1 ? " has" : "s have"} no ${monthLabel} charge yet.` : active.length ? `All active subscribers have a ${monthLabel} charge.` : "No active subscribers yet. Set a customer's stage to Active subscriber and add a monthly fee."),
    h("button", { class: "btn primary small", disabled: !missing.length, onclick: () => act(async () => { const due = todayYMD(); for (const c of missing) await api("/payments", { method: "POST", body: { customerId: c.id, kind: "MONTHLY", amount: c.monthlyFee, period: monthLabel, status: "PENDING", method: "BANK", dueDate: due } }); }, `Added ${missing.length} charge${missing.length === 1 ? "" : "s"}`) }, `Add ${monthLabel} charges`)));

  if (customers.length) {
    const f = { customerId: h("select", {}, customers.map((c) => h("option", { value: c.id }, c.name))), kind: h("select", {}, options(KIND, "MONTHLY")), amount: h("input", { type: "number", min: "0", step: "100", placeholder: "0" }),
      period: h("input", { placeholder: monthLabel, value: monthLabel }), method: h("select", {}, options(METHOD, "BANK")), status: h("select", {}, options(PSTATUS, "PAID")),
      dueDate: h("input", { type: "date" }), paidAt: h("input", { type: "date", value: todayYMD() }), note: h("input", { placeholder: "Receipt no., reference…" }) };
    f.customerId.onchange = () => {
      const c = customers.find((x) => x.id === Number(f.customerId.value)); if (!c) return;
      if (c.dealType === "ONE_TIME") { f.kind.value = "INSTALLMENT"; f.period.value = ""; f.amount.value = c.money?.unbilled || ""; }
      else { f.kind.value = "MONTHLY"; f.period.value = monthLabel; f.amount.value = c.monthlyFee || ""; }
    };
    f.customerId.onchange();
    root.append(h("form", { class: "card card-body form", onsubmit: (e) => { e.preventDefault(); if (f.amount.value === "") return f.amount.focus();
      act(() => api("/payments", { method: "POST", body: { customerId: Number(f.customerId.value), kind: f.kind.value, amount: Number(f.amount.value), period: f.period.value, method: f.method.value, status: f.status.value, dueDate: f.dueDate.value, paidAt: f.status.value === "PAID" ? f.paidAt.value : "", note: f.note.value } }), "Payment recorded"); } },
      field("Customer", f.customerId), field("Type", f.kind), field("Amount (Rs.)", f.amount), field("Period", f.period), field("Method", f.method), field("Status", f.status), field("Due date", f.dueDate), field("Paid on", f.paidAt), field("Note", f.note),
      h("button", { class: "btn primary", type: "submit" }, "Record payment")));
  }
  const today = todayYMD();
  const rows = payments.map((p) => {
    const overdue = p.status === "PENDING" && p.dueDate && ymd(p.dueDate) < today;
    return h("tr", {},
      h("td", {}, p.status === "PAID" ? fmtDate(p.paidAt) : p.dueDate ? `Due ${fmtDate(p.dueDate)}` : "—"),
      h("td", {}, h("b", {}, p.customer.name), p.note ? h("div", { class: "muted", style: "font-size:12px" }, p.note) : null),
      h("td", {}, KIND[p.kind] + (p.period ? ` · ${p.period}` : "")),
      h("td", { class: "num" }, money(p.amount)),
      h("td", {}, METHOD[p.method]),
      h("td", {}, h("span", { class: "pill " + (overdue ? "overdue" : p.status) }, overdue ? "Overdue" : PSTATUS[p.status])),
      h("td", {}, h("div", { class: "actions" },
        p.status === "PENDING" ? h("button", { class: "btn small", onclick: () => act(() => api(`/payments/${p.id}`, { method: "PATCH", body: { status: "PAID", paidAt: today } }), "Marked as paid") }, "Mark paid") : null,
        confirmBtn("Delete", () => act(() => api(`/payments/${p.id}`, { method: "DELETE" }), "Payment deleted")))));
  });
  root.append(h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, `Payment history (${payments.length})`)),
    payments.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Date", "Customer", "For", "Amount", "Method", "Status", ""].map((x, i) => h("th", { class: i === 3 ? "num" : "" }, x)))), h("tbody", {}, rows)))
      : h("div", { class: "empty" }, customers.length ? "No payments recorded yet." : "Add a customer first, then record their payments here.")));
  return root;
}

// ---------- payouts table (shared by admin page and My panel) ----------
function payoutTable(rows, { admin = false } = {}) {
  const today = todayYMD();
  return h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, [admin ? "Paid to" : null, "For", "Amount", "Status", "Date", "Method", admin ? "" : null].filter((x) => x !== null).map((x) => h("th", { class: x === "Amount" ? "num" : "" }, x)))),
    h("tbody", {}, rows.map((p) => {
      const overdue = p.status === "PENDING" && p.dueDate && ymd(p.dueDate) < today;
      return h("tr", {},
        admin ? h("td", {}, h("b", {}, p.user?.name || "Epoch company fund")) : null,
        h("td", {}, p.reason, p.customer ? h("div", { class: "muted", style: "font-size:12px" }, p.customer.name) : null, p.note ? h("div", { class: "muted", style: "font-size:12px" }, p.note) : null),
        h("td", { class: "num" }, money(p.amount)),
        h("td", {}, h("span", { class: "pill " + (overdue ? "overdue" : p.status) }, overdue ? "Overdue" : p.status === "PAID" ? "Paid" : "To be paid")),
        h("td", {}, p.status === "PAID" ? fmtDate(p.paidAt) : p.dueDate ? `Due ${fmtDate(p.dueDate)}` : "—"),
        h("td", {}, METHOD[p.method]),
        admin ? h("td", {}, h("div", { class: "actions" },
          p.status === "PENDING" ? h("button", { class: "btn small", onclick: () => act(() => api(`/payouts/${p.id}`, { method: "PATCH", body: { status: "PAID", paidAt: today } }), "Marked as paid") }, "Mark paid") : null,
          confirmBtn("Delete", () => act(() => api(`/payouts/${p.id}`, { method: "DELETE" }), "Deleted")))) : null);
    }))));
}

// ---------- team payments (admin) ----------
async function pagePayouts() {
  const [payouts, customers, sum] = await Promise.all([api("/payouts"), api("/customers"), api("/summary")]);
  const m = sum.money;
  const root = h("div", { class: "stack" }, head("Money split", "Split what customers pay between the Epoch company fund and the team. Each person sees their own payments on My panel."));
  root.append(h("div", { class: "grid g4" }, kpi(money(m.collected), "Collected from customers"), kpi(money(m.companyFund), "Put into the company fund"),
    kpi(money(m.paidToTeam), "Paid to the team"), kpi(money(m.unsplit), "Collected but not yet split")));
  const active = S.users.filter((u) => u.active);
  const totals = (list) => [list.filter((p) => p.status === "PAID").reduce((s, p) => s + p.amount, 0), list.filter((p) => p.status === "PENDING").reduce((s, p) => s + p.amount, 0)];
  const [cPaid, cPlanned] = totals(payouts.filter((p) => !p.userId));
  root.append(h("div", { class: "grid g4" },
    h("div", { class: "card person", style: "border-color:var(--accent)" }, h("b", {}, "Epoch company fund"), h("span", { class: "muted", style: "font-size:12px" }, "Money kept in the company"),
      h("div", { class: "money-line mono" }, h("span", { class: "paid" }, `In fund ${money(cPaid)}`), h("span", { class: cPlanned ? "due" : "" }, `Planned ${money(cPlanned)}`))),
    active.map((u) => {
      const [paid, owed] = totals(payouts.filter((p) => p.userId === u.id));
      return h("div", { class: "card person" }, h("b", {}, u.name), h("span", { class: "muted", style: "font-size:12px" }, u.title),
        h("div", { class: "money-line mono" }, h("span", { class: "paid" }, `Paid ${money(paid)}`), h("span", { class: owed ? "due" : "" }, `Owed ${money(owed)}`)));
    })));
  const f = { userId: h("select", {}, h("option", { value: "" }, "Epoch company fund"), active.map((u) => h("option", { value: u.id }, u.name))), amount: h("input", { type: "number", min: "0", step: "1000", placeholder: "0" }),
    reason: h("input", { placeholder: "e.g. Company share of City Medical Centre sale" }), customerId: h("select", {}, h("option", { value: "" }, "Not linked"), customers.map((c) => h("option", { value: c.id }, c.name))),
    status: h("select", {}, h("option", { value: "PENDING" }, "To be paid"), h("option", { value: "PAID" }, "Paid")), method: h("select", {}, options(METHOD, "BANK")),
    dueDate: h("input", { type: "date" }), paidAt: h("input", { type: "date", value: todayYMD() }), note: h("input", { placeholder: "Optional" }) };
  root.append(h("form", { class: "card card-body form", onsubmit: (e) => { e.preventDefault();
    if (!f.reason.value.trim()) return f.reason.focus(); if (f.amount.value === "") return f.amount.focus();
    act(() => api("/payouts", { method: "POST", body: { userId: numOrNull(f.userId.value), amount: Number(f.amount.value), reason: f.reason.value, customerId: numOrNull(f.customerId.value), status: f.status.value, method: f.method.value, dueDate: f.dueDate.value, paidAt: f.status.value === "PAID" ? f.paidAt.value : "", note: f.note.value } }), "Team payment added"); } },
    field("Pay to", f.userId), field("Amount (Rs.)", f.amount), field("For", f.reason), field("From customer", f.customerId), field("Status", f.status), field("Method", f.method),
    field("Due date", f.dueDate), field("Paid on", f.paidAt), field("Note", f.note), h("button", { class: "btn primary", type: "submit" }, "Add")));
  root.append(h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, `All splits (${payouts.length})`)),
    payouts.length ? payoutTable(payouts, { admin: true }) : h("div", { class: "empty" }, "Nothing split yet. Add the company's share and each person's share of a sale above.")));
  return root;
}

// ---------- my panel (everyone, including the admin) ----------
async function pageMe() {
  const [plan, tasks, software, payouts] = await Promise.all([api("/plan"), api("/tasks"), api("/software"), api("/me/payouts")]);
  const dn = dayNum(plan.start);
  const mine = tasks.filter((t) => t.assigneeId === S.me.id);
  const open = mine.filter((t) => t.status !== "DONE"), done = mine.length - open.length;
  const received = payouts.filter((p) => p.status === "PAID").reduce((s, p) => s + p.amount, 0), owed = payouts.filter((p) => p.status === "PENDING").reduce((s, p) => s + p.amount, 0);
  const roles = software.flatMap((s) => s.assignments.filter((a) => a.userId === S.me.id).map((a) => ({ sw: s.name, r: a.responsibility })));
  const root = h("div", { class: "stack" }, head(`${S.me.name}'s panel`, `${S.users.find((u) => u.id === S.me.id)?.title || ""}${dn != null && dn >= 1 && dn <= 30 ? ` · Day ${dn} of 30` : ""}`));
  root.append(h("div", { class: "grid g4" }, kpi(String(open.length), "Open tasks"), kpi(`${done}/${mine.length}`, "Tasks done"), kpi(money(received), "Paid to you"), kpi(money(owed), "Owed to you")));
  const byPhase = plan.phases.map((p) => ({ p, list: open.filter((t) => t.phase === p.n) })).filter((x) => x.list.length);
  root.append(h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "My open tasks"), h("a", { href: "#tasks", class: "btn small" }, "Open task board")),
    byPhase.length ? byPhase.map(({ p, list }) => h("div", {}, h("div", { class: "muted", style: "font-size:12px;padding:10px 16px 0;font-weight:600" }, p.ongoing ? p.title : `Days ${p.from}–${p.to} · ${p.title} · ${phaseDates(p, plan.start)}`),
      h("ul", { class: "tasks", style: "border-top:0" }, list.map((t) => taskRow(t, plan, { compact: true }))))) : h("div", { class: "empty" }, "No open tasks. Nice work.")));
  root.append(h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "My software")),
    roles.length ? h("div", { class: "card-body assign" }, roles.map((x) => h("span", { class: "chip mine" }, `${x.sw} · ${x.r}`))) : h("div", { class: "empty" }, "You're not assigned to any software yet.")));
  root.append(h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "My payments from Epoch")),
    payouts.length ? payoutTable(payouts) : h("div", { class: "empty" }, "No payments recorded for you yet.")));
  return root;
}

// ---------- team (admin) ----------
async function pageTeam() {
  const root = h("div", { class: "stack" }, head("Team accounts", "Create sign-ins for team members. New members must choose their own password the first time they sign in."));
  const f = { name: h("input", { placeholder: "Full name" }), username: h("input", { placeholder: "lowercase, e.g. nimal", autocapitalize: "none" }), title: h("input", { placeholder: "e.g. Sales" }),
    role: h("select", {}, h("option", { value: "MEMBER" }, "Team member"), h("option", { value: "ADMIN" }, "Admin")), password: h("input", { type: "text", placeholder: "At least 8 characters", autocomplete: "off" }) };
  root.append(h("form", { class: "card card-body form", onsubmit: (e) => { e.preventDefault();
    act(() => api("/users", { method: "POST", body: { name: f.name.value, username: f.username.value, title: f.title.value, role: f.role.value, password: f.password.value } }), "Team member added. Share the username and temporary password with them."); } },
    field("Name", f.name), field("Username", f.username), field("Job title", f.title), field("Role", f.role), field("Temporary password", f.password), h("button", { class: "btn primary", type: "submit" }, "Add member")));
  const tbody = h("tbody");
  for (const u of S.users) {
    const open = S.open === "u" + u.id;
    tbody.append(h("tr", {},
      h("td", {}, h("b", {}, u.name), h("div", { class: "muted", style: "font-size:12px" }, u.title)),
      h("td", { class: "mono" }, u.username),
      h("td", {}, h("span", { class: "pill " + u.role }, u.role === "ADMIN" ? "Admin" : "Member")),
      h("td", {}, !u.active ? h("span", { class: "pill LOST" }, "Disabled") : u.mustChangePassword ? h("span", { class: "pill PENDING" }, "Must set password") : h("span", { class: "pill PAID" }, "Active")),
      h("td", {}, h("button", { class: "btn small", onclick: () => { S.open = open ? null : "u" + u.id; route(); } }, open ? "Close" : "Manage"))));
    if (open) {
      const e = { name: h("input", { value: u.name }), title: h("input", { value: u.title }), role: h("select", { disabled: u.id === S.me.id }, h("option", { value: "MEMBER", selected: u.role === "MEMBER" }, "Team member"), h("option", { value: "ADMIN", selected: u.role === "ADMIN" }, "Admin")),
        active: h("select", { disabled: u.id === S.me.id }, h("option", { value: "1", selected: u.active }, "Can sign in"), h("option", { value: "0", selected: !u.active }, "Disabled")), pw: h("input", { type: "text", placeholder: "New temporary password", autocomplete: "off" }) };
      tbody.append(h("tr", {}, h("td", { colspan: "5", style: "background:var(--surface-2)" }, h("div", { class: "form" },
        field("Name", e.name), field("Job title", e.title), field("Role", e.role), field("Access", e.active),
        h("div", { class: "actions" }, h("button", { class: "btn primary small", onclick: () => act(() => api(`/users/${u.id}`, { method: "PATCH", body: { name: e.name.value, title: e.title.value, ...(u.id === S.me.id ? {} : { role: e.role.value, active: e.active.value === "1" }) } }), "Saved") }, "Save")),
        u.id === S.me.id ? null : field("Reset password", e.pw),
        u.id === S.me.id ? h("div", { class: "muted", style: "font-size:12px" }, "Change your own password on My account.") : h("div", { class: "actions" }, h("button", { class: "btn small", onclick: () => act(() => api(`/users/${u.id}/password`, { method: "POST", body: { password: e.pw.value } }), "Password reset. They must choose a new one at next sign-in.") }, "Reset password"))))));
    }
  }
  root.append(h("div", { class: "card" }, h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Name", "Username", "Role", "Status", ""].map((x) => h("th", {}, x)))), tbody))));
  return root;
}

// ---------- account ----------
async function pageAccount() {
  const cur = h("input", { type: "password", autocomplete: "current-password" }), np = h("input", { type: "password", autocomplete: "new-password" }), np2 = h("input", { type: "password", autocomplete: "new-password" });
  const err = h("div", { class: "error", hidden: true });
  const form = h("form", { class: "card card-body form", style: "max-width:520px;grid-template-columns:1fr", onsubmit: async (e) => {
    e.preventDefault(); err.hidden = true;
    if (np.value !== np2.value) { err.textContent = "The new passwords don't match."; err.hidden = false; return; }
    try { await api("/me/password", { method: "POST", body: { currentPassword: cur.value, newPassword: np.value } }); S.me.mustChangePassword = false; toast("Password changed"); location.hash = "#me"; }
    catch (x) { err.textContent = x.message; err.hidden = false; }
  } }, err, field(S.me.mustChangePassword ? "Temporary password" : "Current password", cur), field("New password (at least 8 characters)", np), field("Repeat new password", np2), h("div", { class: "actions" }, h("button", { class: "btn primary", type: "submit" }, "Change password")));
  return h("div", { class: "stack" }, head("My account", `${S.me.name} · signed in as ${S.me.username}${isAdmin() ? " · Admin" : ""}`),
    S.me.mustChangePassword ? h("div", { class: "alert" }, h("div", {}, h("b", {}, "Choose your own password. "), "You signed in with a temporary password. Set a new one to open the rest of the panel.")) : null,
    form);
}

boot();

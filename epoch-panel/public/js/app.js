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

// api() comes from data.js (Supabase)
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
// Select values → ids: numbers for software/customers/plans, text (uuid) for team members
const numOrNull = (v) => (v === "" ? null : /^\d+$/.test(v) ? Number(v) : v);
const isAdmin = () => S.me?.role === "ADMIN";
const S = { me: null, users: [], open: null };

// ---------- shell ----------
async function boot() {
  try { S.me = (await api("/me")).user; } catch { return; }
  $("meName").textContent = S.me.name;
  $("meRole").textContent = isAdmin() ? "· Admin" : "";
  document.querySelectorAll("[data-admin]").forEach((a) => (a.hidden = !isAdmin()));
  $("logout").onclick = async () => { await api("/logout", { method: "POST" }).catch(() => {}); location.replace("index.html"); };
  window.addEventListener("hashchange", () => { S.open = null; route(); });
  if (!location.hash) location.hash = S.me.mustChangePassword ? "#account" : "#me";
  else route();
}

const PAGES = { me: pageMe, dashboard: pageDashboard, tasks: pageTasks, customers: pageCustomers, software: pageSoftware, plans: pagePlans, payments: pagePayments, payouts: pagePayouts, team: pageTeam, account: pageAccount };
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

// ---------- helpers ----------
const todayLong = () => new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
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
  const [sum, tasks] = await Promise.all([api("/summary"), api("/tasks")]);
  const root = h("div", { class: "stack" }, head(`Hello, ${S.me.name}`, todayLong()));
  root.append(anniversaryCard(COMPANY));
  root.append(...trialAlerts(sum.trials));
  if (sum.money) root.append(moneyKpis(sum.money));
  const pct = sum.tasks.total ? Math.round((sum.tasks.done / sum.tasks.total) * 100) : 0;
  root.append(h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "Team progress"), h("span", { class: "muted mono" }, `${sum.tasks.done}/${sum.tasks.total} tasks · ${pct}%`)),
    h("div", { class: "grid g3", style: "padding:12px" }, sum.people.map((p) => h("div", { class: "card person" },
      h("b", {}, p.name), h("span", { class: "muted", style: "font-size:12px" }, p.title || (p.role === "ADMIN" ? "Admin" : "Team member")),
      h("div", { class: "bar" }, h("b", { style: `width:${p.total ? (p.done / p.total) * 100 : 0}%` })),
      h("span", { class: "muted mono", style: "font-size:12px" }, `${p.done}/${p.total} done · ${p.doing} in progress`))))));
  const mine = sortTasks(tasks.filter((t) => t.assigneeId === S.me.id && t.status !== "DONE"));
  root.append(h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "Your tasks now"), h("a", { href: "#tasks", class: "btn small" }, "Open task board")),
    mine.length ? h("ul", { class: "tasks", style: "border-top:0" }, mine.map((t) => taskRow(t, { compact: true }))) : h("div", { class: "empty" }, "Nothing due right now.")));
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
const priceText = (c) => c.dealType === "ONE_TIME" ? (c.totalPrice ? `${money(c.totalPrice)} one-time` : "One-time") : (c.plan ? c.plan.name + " · " : "") + (c.monthlyFee ? `${money(c.monthlyFee)} / month` : c.plan ? "" : "—");

// ---------- task board ----------
const TF = { person: "me", hideDone: true }; // admin can switch person; members always see their own
function canEditTask(t) { return isAdmin() || t.assigneeId === S.me.id; }
const nextStatus = (s) => ({ TODO: "DOING", DOING: "DONE", DONE: "TODO" })[s];
// Open tasks first, then by due date (no date last), then oldest first
const sortTasks = (list) => [...list].sort((a, b) => ((a.status === "DONE") - (b.status === "DONE")) || ((a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : (a.dueDate || "9999") > (b.dueDate || "9999") ? 1 : 0) || (a.id - b.id));

// Due-date label: Overdue / Today / Tomorrow / date
function dueLabel(t) {
  if (!t.dueDate) return null;
  const d = daysUntil(t.dueDate);
  if (t.status === "DONE") return { text: `Due ${fmtDate(t.dueDate)}`, cls: "" };
  if (d < 0) return { text: `Overdue · was due ${fmtDate(t.dueDate)}`, cls: "due-late" };
  if (d === 0) return { text: "Due today", cls: "due-soon" };
  if (d === 1) return { text: "Due tomorrow", cls: "due-soon" };
  return { text: `Due ${fmtDate(t.dueDate)}`, cls: "" };
}
function taskSubline(t, compact) {
  const due = dueLabel(t), parts = [];
  if (due) parts.push(h("span", { class: due.cls }, due.text));
  if (t.status === "DOING") parts.push(h("span", { style: "color:var(--warn)" }, "In progress"));
  if (!compact && t.notes) parts.push(t.notes);
  if (!parts.length) return null;
  return h("small", {}, parts.flatMap((p, i) => (i ? [" · ", p] : [p])));
}
function taskRow(t, { compact = false } = {}) {
  const open = S.open === "t" + t.id, can = canEditTask(t);
  const li = h("li", { class: "task" + (t.status === "DONE" ? " is-done" : "") });
  li.append(h("div", { class: "trow" },
    h("button", { class: "stbtn", "data-s": t.status, disabled: !can, title: can ? `${TSTATUS[t.status]} · click for ${TSTATUS[nextStatus(t.status)]}` : TSTATUS[t.status], "aria-label": `${t.title}: ${TSTATUS[t.status]}`,
      onclick: () => act(() => api(`/tasks/${t.id}`, { method: "PATCH", body: { status: nextStatus(t.status) } })) }),
    h("div", { class: "ttitle" }, t.title, taskSubline(t, compact)),
    h("span", { class: "chip" + (t.assigneeId === S.me.id ? " mine" : "") }, t.assignee?.name || "Whole team"),
    compact ? h("span") : h("button", { class: "more", "aria-expanded": String(open), "aria-label": "Details for " + t.title, onclick: () => { S.open = open ? null : "t" + t.id; route(); } }, open ? "▴" : "▾")));
  if (open && !compact) {
    const title = h("input", { value: t.title, disabled: !isAdmin() });
    const assignee = h("select", { disabled: !isAdmin() }, userOptions(t.assigneeId, { none: "Whole team" }));
    const status = h("select", { disabled: !can }, options(TSTATUS, t.status));
    const due = h("input", { type: "date", value: ymd(t.dueDate), disabled: !isAdmin() });
    const notes = h("textarea", { disabled: !can, placeholder: "Links, progress, who you spoke to…" }, t.notes);
    const save = () => {
      const body = { status: status.value, notes: notes.value };
      if (isAdmin()) Object.assign(body, { title: title.value, assigneeId: numOrNull(assignee.value), dueDate: due.value });
      act(() => api(`/tasks/${t.id}`, { method: "PATCH", body }), "Task saved");
    };
    li.append(h("div", { class: "tedit" }, h("div", { class: "form" },
      field("Task", title, "full"), field("Assigned to", assignee), field("Status", status), field("Due date", due), field("Notes", notes, "full"),
      h("div", { class: "actions full" },
        !can ? h("span", { class: "muted", style: "font-size:12px" }, "Only the assignee or the admin can change this task.") : null,
        isAdmin() ? confirmBtn("Delete", () => act(() => api(`/tasks/${t.id}`, { method: "DELETE" }), "Task deleted")) : null,
        can ? h("button", { class: "btn primary small", onclick: save }, "Save") : null))));
  }
  return li;
}
// Split tasks into Overdue / Due today / Coming up / No due date / Done
function taskGroups(list) {
  const g = { late: [], today: [], soon: [], none: [], done: [] };
  for (const t of sortTasks(list)) {
    if (t.status === "DONE") g.done.push(t);
    else if (!t.dueDate) g.none.push(t);
    else { const d = daysUntil(t.dueDate); (d < 0 ? g.late : d === 0 ? g.today : g.soon).push(t); }
  }
  return [["late", "Overdue", g.late], ["today", "Due today", g.today], ["soon", "Coming up", g.soon], ["none", "No due date", g.none], ["done", "Done", g.done]];
}

async function pageTasks() {
  const tasks = await api("/tasks");
  const root = h("div", { class: "stack" }, head("Task board", isAdmin() ? "Add tasks and assign them to the team. Each person sees their own tasks." : "Your tasks from Hishma. Tick the circle as you work through them."));

  // Admin: add and assign a task
  if (isAdmin()) {
    const f = { title: h("input", { placeholder: "e.g. Call Garden Cafe about a website" }), assigneeId: h("select", {}, userOptions(null, { none: "Whole team" })),
      dueDate: h("input", { type: "date", value: todayYMD() }), notes: h("input", { placeholder: "Details, phone numbers, links (optional)" }) };
    f.assigneeId.value = "";
    root.append(h("form", { class: "card card-body form", onsubmit: (e) => { e.preventDefault(); if (!f.title.value.trim()) return f.title.focus();
      act(() => api("/tasks", { method: "POST", body: { title: f.title.value, assigneeId: numOrNull(f.assigneeId.value), dueDate: f.dueDate.value, notes: f.notes.value } }), "Task added and assigned"); } },
      field("New task", f.title, "full"), field("Assign to", f.assigneeId), field("Due date", f.dueDate), field("Notes", f.notes), h("button", { class: "btn primary", type: "submit" }, "Add task")));
  }

  if (!isAdmin()) TF.person = "me";
  let person = null;
  if (isAdmin()) {
    person = h("select", { class: "inp", style: "width:auto", "aria-label": "Show tasks for", onchange: (e) => { TF.person = e.target.value; route(); } },
      h("option", { value: "" }, "Everyone"), h("option", { value: "me" }, "My tasks"),
      S.users.filter((u) => u.id !== S.me.id && u.active).map((u) => h("option", { value: String(u.id) }, `${u.name}'s tasks`)), h("option", { value: "none" }, "Whole-team tasks"));
    person.value = TF.person;
  }
  root.append(h("div", { class: "actions", style: "justify-content:flex-start" }, person,
    h("label", { style: "display:flex;gap:6px;align-items:center;color:var(--muted)" }, h("input", { type: "checkbox", checked: TF.hideDone, onchange: (e) => { TF.hideDone = e.target.checked; route(); } }), "Hide done")));

  const forPerson = (t) => !TF.person || (TF.person === "none" ? !t.assigneeId : !t.assigneeId || (TF.person === "me" ? t.assigneeId === S.me.id : String(t.assigneeId) === TF.person));
  const mine = tasks.filter(forPerson);
  let any = false;
  for (const [key, label, list] of taskGroups(mine)) {
    if (!list.length || (key === "done" && TF.hideDone)) continue;
    any = true;
    root.append(h("section", { class: "card" + (key === "late" ? " late" : key === "today" ? " phase now" : "") },
      h("div", { class: "card-head" }, h("h2", { class: key === "late" ? "due-late" : "" }, label), h("span", { class: "muted mono" }, String(list.length))),
      h("ul", { class: "tasks", style: "border-top:0" }, list.map((t) => taskRow(t)))));
  }
  if (!any) root.append(h("div", { class: "card empty" }, mine.length ? "Everything is done. Untick “Hide done” to see finished tasks." : isAdmin() ? "No tasks yet. Add the first one above." : "No tasks for you yet. Hishma will assign them here."));
  return root;
}

// ---------- customers ----------
async function pageCustomers() {
  const [customers, software, plans] = await Promise.all([api("/customers"), api("/software"), api("/plans")]);
  const swOptions = (val) => [h("option", { value: "" }, "Not chosen"), ...software.map((s) => h("option", { value: s.id, selected: s.id === val }, s.name))];
  const planOptions = (val) => [h("option", { value: "" }, "No plan"), ...plans.filter((p) => p.active || p.id === val).map((p) => h("option", { value: p.id, selected: p.id === val }, `${p.name} · ${money(p.monthlyPrice)}/mo`))];
  const typeOpts = (val) => ["Shop", "Restaurant", "Salon", "Clinic", "School", "Other"].map((t) => h("option", { value: t, selected: t === val }, t));
  const root = h("div", { class: "stack" }, head("Customers", "Leads, free trials and paying subscribers"));
  root.append(...trialAlerts(customers.filter((c) => c.stage === "FREE_TRIAL")));

  const f = { name: h("input", { placeholder: "e.g. Green Leaf Café" }), contact: h("input", { placeholder: "Owner or manager" }), phone: h("input", { placeholder: "Phone / WhatsApp" }), email: h("input", { type: "email", placeholder: "name@business.lk" }),
    type: h("select", {}, typeOpts("Shop")), softwareId: h("select", {}, swOptions(null)), ownerId: h("select", {}, userOptions(S.users.find((u) => u.username === "hansa")?.id ?? S.me.id)), stage: h("select", {}, options(STAGE, "NEW")),
    dealType: h("select", {}, options(DEAL, "SUBSCRIPTION")), price: h("input", { type: "number", min: "0", step: "1000", placeholder: "0" }), planId: h("select", {}, planOptions(null)) };
  const priceLabel = h("span", {}, "Monthly fee (Rs.)");
  f.dealType.onchange = () => (priceLabel.textContent = f.dealType.value === "ONE_TIME" ? "Full price (Rs.)" : "Monthly fee (Rs.)");
  f.planId.onchange = () => { const p = plans.find((x) => x.id === Number(f.planId.value)); if (p) { f.dealType.value = "SUBSCRIPTION"; f.dealType.onchange(); f.price.value = p.monthlyPrice; } };
  const addForm = h("form", { class: "card card-body form", onsubmit: (e) => { e.preventDefault(); if (!f.name.value.trim()) return f.name.focus();
    const price = Number(f.price.value) || 0, oneTime = f.dealType.value === "ONE_TIME";
    act(() => api("/customers", { method: "POST", body: { name: f.name.value, contact: f.contact.value, phone: f.phone.value, email: f.email.value, type: f.type.value, softwareId: numOrNull(f.softwareId.value), ownerId: numOrNull(f.ownerId.value), stage: f.stage.value, dealType: f.dealType.value, totalPrice: oneTime ? price : 0, monthlyFee: oneTime ? 0 : price, planId: numOrNull(f.planId.value) } }), "Customer added"); } },
    field("Business name", f.name), field("Contact person", f.contact), field("Phone", f.phone), field("Email", f.email), field("Type", f.type), field("Software", f.softwareId), field("Handled by", f.ownerId), field("Stage", f.stage),
    field("Subscription plan", f.planId), field("Deal", f.dealType), field(priceLabel, f.price),
    h("button", { class: "btn primary", type: "submit" }, "Add customer"));
  root.append(addForm);

  const tbody = h("tbody");
  for (const c of customers) {
    const open = S.open === "c" + c.id, mailOpen = S.open === "m" + c.id;
    tbody.append(h("tr", {},
      h("td", {}, h("b", {}, c.name), h("div", { class: "muted", style: "font-size:12px" }, [c.type, c.contact, c.phone, c.email].filter(Boolean).join(" · "))),
      h("td", {}, c.software?.name || "—"),
      h("td", {}, h("span", { class: "pill " + c.stage }, STAGE[c.stage])),
      h("td", {}, c.owner?.name || "—"),
      h("td", {}, h("div", { class: "mono" }, priceText(c)), moneyLine(c)),
      h("td", {}, c.stage === "FREE_TRIAL" && c.trialEnds ? `Free until ${fmtDate(c.trialEnds)}` : c.startedAt ? `Since ${fmtDate(c.startedAt)}` : ""),
      h("td", {}, h("div", { class: "actions", style: "flex-wrap:nowrap" },
        h("button", { class: "btn small", onclick: () => { S.open = mailOpen ? null : "m" + c.id; route(); } }, mailOpen ? "Close" : "Email"),
        h("button", { class: "btn small", onclick: () => { S.open = open ? null : "c" + c.id; route(); } }, open ? "Close" : "Edit")))));
    if (mailOpen) tbody.append(h("tr", {}, h("td", { colspan: "7", style: "background:var(--surface-2)" }, await emailComposer(c, plans))));
    if (open) {
      const e = { name: h("input", { value: c.name }), contact: h("input", { value: c.contact }), phone: h("input", { value: c.phone }), email: h("input", { type: "email", value: c.email || "" }), type: h("select", {}, typeOpts(c.type)),
        softwareId: h("select", {}, swOptions(c.softwareId)), ownerId: h("select", {}, userOptions(c.ownerId)), stage: h("select", {}, options(STAGE, c.stage)),
        planId: h("select", {}, planOptions(c.planId)),
        dealType: h("select", {}, options(DEAL, c.dealType)), totalPrice: h("input", { type: "number", min: "0", step: "1000", value: c.totalPrice }),
        monthlyFee: h("input", { type: "number", min: "0", step: "100", value: c.monthlyFee }), startedAt: h("input", { type: "date", value: ymd(c.startedAt) }), trialEnds: h("input", { type: "date", value: ymd(c.trialEnds) }),
        notes: h("textarea", {}, c.notes) };
      e.planId.onchange = () => { const p = plans.find((x) => x.id === Number(e.planId.value)); if (p) { e.dealType.value = "SUBSCRIPTION"; e.monthlyFee.value = p.monthlyPrice; } };
      const save = () => act(() => api(`/customers/${c.id}`, { method: "PATCH", body: { name: e.name.value, contact: e.contact.value, phone: e.phone.value, email: e.email.value, type: e.type.value, softwareId: numOrNull(e.softwareId.value), ownerId: numOrNull(e.ownerId.value), stage: e.stage.value, planId: numOrNull(e.planId.value), dealType: e.dealType.value, totalPrice: Number(e.totalPrice.value) || 0, monthlyFee: Number(e.monthlyFee.value) || 0, startedAt: e.startedAt.value, trialEnds: e.trialEnds.value, notes: e.notes.value } }), "Customer saved");
      tbody.append(h("tr", {}, h("td", { colspan: "7", style: "background:var(--surface-2)" }, h("div", { class: "form" },
        field("Business name", e.name), field("Contact person", e.contact), field("Phone", e.phone), field("Email", e.email), field("Type", e.type), field("Software", e.softwareId), field("Handled by", e.ownerId), field("Stage", e.stage),
        field("Subscription plan", e.planId), field("Deal", e.dealType), field("Full price (one-time, Rs.)", e.totalPrice), field("Monthly fee (subscription, Rs.)", e.monthlyFee), field("Customer since", e.startedAt), field("Free period ends", e.trialEnds), field("Notes", e.notes, "full"),
        h("div", { class: "actions full" }, isAdmin() ? confirmBtn("Delete customer", () => act(() => api(`/customers/${c.id}`, { method: "DELETE" }), "Customer deleted")) : null, h("button", { class: "btn primary small", onclick: save }, "Save"))))));
    }
  }
  root.append(h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, `All customers (${customers.length})`)),
    customers.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Business", "Software", "Stage", "Handled by", "Price", "Dates", ""].map((x) => h("th", {}, x)))), tbody))
      : h("div", { class: "empty" }, "No customers yet. Add the first one above.")));
  return root;
}

// ---------- customer emails (sent from Epoch's Gmail by the send-email Edge Function) ----------
const SIGNOFF = () => `Kind regards,\n${S.me.name}\nEpoch · Empowering possibilities through technology`;
function emailTemplate(kind, c, plans) {
  const hi = `Dear ${c.contact || c.name},`;
  const plan = plans.find((p) => p.id === c.planId) || plans.find((p) => p.active);
  const due = c.money?.pending ? money(c.money.pending) : "Rs. [amount]";
  const T = {
    intro: [`Epoch: a website for ${c.name}`,
      `${hi}\n\nThank you for speaking with us. Epoch builds websites and software for local businesses: business and restaurant websites, online stores, Smart POS billing and clinic management systems.\n\nWe would be happy to show you a demo and suggest what would work best for ${c.name}. Just reply to this email with a good time to talk.\n\n${SIGNOFF()}`],
    quote: [`Epoch quotation for ${c.name}`,
      `${hi}\n\nThank you for your interest. Here is our proposal:\n\n` +
      (plan ? `Plan: ${plan.name}\nMonthly: ${money(plan.monthlyPrice)}${plan.annualPrice ? `\nYearly: ${money(plan.annualPrice)}` : ""}${plan.setupFee ? `\nOne-time setup: ${money(plan.setupFee)}` : ""}` +
        (plan.includes ? `\n\nIncluded:\n${plan.includes.split("\n").filter(Boolean).map((l) => "- " + l.trim()).join("\n")}` : "")
        : `Plan: [plan name]\nMonthly: Rs. [amount]\nOne-time setup: Rs. [amount]`) +
      `\n\nReply to this email to go ahead or ask any questions.\n\n${SIGNOFF()}`],
    reminder: [`Payment reminder: ${c.name}`,
      `${hi}\n\nThis is a friendly reminder that ${due} is still due for ${c.software?.name || "your system"}.\n\nIf you have already paid, please ignore this message, and thank you. If you have any questions, just reply to this email.\n\n${SIGNOFF()}`],
    receipt: [`Payment received: thank you`,
      `${hi}\n\nWe have received your payment of Rs. [amount] for ${c.software?.name || "your system"}. Thank you.\n\n${SIGNOFF()}`],
    welcome: [`Welcome to Epoch, ${c.name}`,
      `${hi}\n\nWelcome to Epoch, and thank you for choosing us. We are getting started on your project and will keep you updated.\n\nIf you need anything, just reply to this email.\n\n${SIGNOFF()}`],
    blank: ["", `${hi}\n\n\n\n${SIGNOFF()}`],
  };
  return T[kind];
}
const EMAIL_TEMPLATES = { intro: "Introduction", quote: "Quotation", reminder: "Payment reminder", receipt: "Payment receipt", welcome: "Welcome", blank: "Blank" };

async function emailComposer(c, plans) {
  const box = h("div", { class: "stack", style: "gap:12px" });
  if (!c.email) {
    box.append(h("div", { class: "muted" }, "Add this customer's email address first: click Edit, fill in Email, then Save."));
    return box;
  }
  const [quota, history] = await Promise.all([api("/emails/quota", { method: "POST" }).catch(() => null), api(`/emails?customer=${c.id}`).catch(() => [])]);
  const tpl = h("select", {}, options(EMAIL_TEMPLATES, "intro"));
  const subject = h("input", { maxlength: "150" }), message = h("textarea", { rows: "11", maxlength: "5000" });
  const fill = () => { const [s, m] = emailTemplate(tpl.value, c, plans); subject.value = s; message.value = m; };
  tpl.onchange = fill; fill();
  const left = quota ? quota.left : null;
  const status = quota && !quota.ready ? h("div", { class: "error" }, "Email isn't set up yet: the Gmail App Password still needs adding in Supabase (Edge Functions → Secrets → GMAIL_APP_PASSWORD).")
    : h("div", { class: "muted", style: "font-size:13px" }, !quota ? "" : quota.limit == null ? `${quota.used} sent today.` : `${left} of ${quota.limit} emails left today.`);
  const send = h("button", { class: "btn primary small", type: "submit", disabled: left === 0 || (quota && !quota.ready) }, "Send email");
  box.append(h("form", { class: "form", onsubmit: async (ev) => {
      ev.preventDefault();
      if (!subject.value.trim()) return subject.focus();
      if (/\[(amount|plan name)\]/.test(message.value + subject.value)) { toast("Fill in the [amount] or [plan name] placeholders first."); return message.focus(); }
      send.disabled = true; send.textContent = "Sending…";
      try {
        const r = await api("/emails/send", { method: "POST", body: { customerId: c.id, template: tpl.value, subject: subject.value, message: message.value } });
        toast(`Email sent to ${c.email}.` + (r.left != null ? ` ${r.left} left today.` : "")); await route();
      } catch (x) { toast(x.message); send.disabled = false; send.textContent = "Send email"; }
    } },
    h("div", { class: "full", style: "font-size:13px" }, h("b", {}, "To: "), `${c.name} <${c.email}>`),
    field("Template", tpl), field("Subject", subject), field("Message", message, "full"),
    h("div", { class: "actions full", style: "justify-content:space-between" }, status, send)));
  box.append(h("div", {}, h("b", { style: "font-size:13px" }, `Emails sent to ${c.name}`),
    history.length ? h("ul", { style: "margin:6px 0 0;padding-left:18px;font-size:13px" }, history.map((m) => h("li", {},
      `${new Date(m.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${m.subject} · ${m.sender?.name || "?"} · `,
      h("span", { class: m.status === "SENT" ? "due-soon" : "due-late" }, m.status === "SENT" ? "Sent" : "Failed" + (m.error ? `: ${m.error}` : "")))))
      : h("div", { class: "muted", style: "font-size:13px" }, "None yet.")));
  return box;
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
      body.append(h("div", { class: "actions", style: "justify-content:flex-start" }, u, r, h("button", { class: "btn small primary", onclick: () => act(() => api(`/software/${sw.id}/assignments`, { method: "POST", body: { userId: u.value, responsibility: r.value } }), "Assigned") }, "Assign"),
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

// ---------- subscription plans ----------
async function pagePlans() {
  const plans = await api("/plans");
  const root = h("div", { class: "stack" }, head("Subscription plans", "Monthly plans Epoch sells for websites. Each includes hosting, so the customer never deals with a hosting company."));
  const card = (p) => {
    const editing = S.open === "p" + p.id;
    const lines = (p.includes || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const body = h("div", { class: "card-body" },
      h("div", { class: "price mono" }, money(p.monthlyPrice), h("span", {}, " / month")),
      h("div", { class: "muted", style: "font-size:13px" }, [p.annualPrice ? `or ${money(p.annualPrice)} / year` : "", p.setupFee ? `Setup ${money(p.setupFee)}` : "No setup fee"].filter(Boolean).join(" · ")),
      p.bestFor ? h("div", {}, h("b", {}, "Best for: "), p.bestFor) : null,
      lines.length ? h("ul", {}, lines.map((l) => h("li", {}, l))) : null,
      isAdmin() ? h("div", { class: "cost mono" }, `Hosting: ${p.hostingPlan || "—"} · ${money(p.hostingCost)}/mo`, h("br"), `Epoch keeps ${money(p.monthlyPrice - p.hostingCost)}/mo before work time`) : null,
      h("div", { class: "muted", style: "font-size:12px" }, `${p._count.customers} customer${p._count.customers === 1 ? "" : "s"}${p.active ? "" : " · Not on sale"}`));
    if (isAdmin() && !editing) body.append(h("div", { class: "actions" }, h("button", { class: "btn small", onclick: () => { S.open = "p" + p.id; route(); } }, "Edit")));
    if (editing) {
      const e = { name: h("input", { value: p.name }), bestFor: h("input", { value: p.bestFor }), monthlyPrice: h("input", { type: "number", min: "0", step: "100", value: p.monthlyPrice }),
        annualPrice: h("input", { type: "number", min: "0", step: "1000", value: p.annualPrice }), setupFee: h("input", { type: "number", min: "0", step: "1000", value: p.setupFee }),
        hostingPlan: h("input", { value: p.hostingPlan }), hostingCost: h("input", { type: "number", min: "0", value: p.hostingCost }), includes: h("textarea", { rows: "7" }, p.includes),
        active: h("select", {}, h("option", { value: "1", selected: p.active }, "On sale"), h("option", { value: "0", selected: !p.active }, "Not on sale")) };
      body.replaceChildren(h("div", { class: "form", style: "grid-template-columns:1fr 1fr" },
        field("Plan name", e.name, "full"), field("Best for", e.bestFor, "full"), field("Monthly (Rs.)", e.monthlyPrice), field("Yearly (Rs.)", e.annualPrice), field("Setup fee (Rs.)", e.setupFee), field("Status", e.active),
        field("Hosting package", e.hostingPlan), field("Hosting cost / month (Rs.)", e.hostingCost), field("What's included (one per line)", e.includes, "full"),
        h("div", { class: "actions full" }, confirmBtn("Delete", () => act(() => api(`/plans/${p.id}`, { method: "DELETE" }), "Plan deleted")),
          h("button", { class: "btn small", onclick: () => { S.open = null; route(); } }, "Cancel"),
          h("button", { class: "btn primary small", onclick: () => act(async () => { await api(`/plans/${p.id}`, { method: "PATCH", body: { name: e.name.value, bestFor: e.bestFor.value, monthlyPrice: Number(e.monthlyPrice.value) || 0, annualPrice: Number(e.annualPrice.value) || 0, setupFee: Number(e.setupFee.value) || 0, hostingPlan: e.hostingPlan.value, hostingCost: Number(e.hostingCost.value) || 0, includes: e.includes.value, active: e.active.value === "1" } }); S.open = null; }, "Plan saved") }, "Save"))));
    }
    return h("div", { class: "card plan" + (p.active ? "" : " muted") }, h("div", { class: "card-head" }, h("h2", {}, p.name)), body);
  };
  root.append(plans.length ? h("div", { class: "plans" }, plans.map(card)) : h("div", { class: "card empty" }, "No plans yet."));
  if (isAdmin()) {
    const n = h("input", { placeholder: "e.g. School" }), m = h("input", { type: "number", min: "0", step: "100", placeholder: "0" });
    root.append(h("form", { class: "card card-body form", onsubmit: (ev) => { ev.preventDefault(); if (!n.value.trim()) return n.focus(); act(() => api("/plans", { method: "POST", body: { name: n.value, monthlyPrice: Number(m.value) || 0, order: plans.length + 1 } }), "Plan added"); } },
      field("New plan name", n), field("Monthly price (Rs.)", m), h("button", { class: "btn primary", type: "submit" }, "Add plan")));
  }
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
  const [tasks, software, payouts] = await Promise.all([api("/tasks"), api("/software"), api("/me/payouts")]);
  const mine = tasks.filter((t) => t.assigneeId === S.me.id);
  const open = mine.filter((t) => t.status !== "DONE"), done = mine.length - open.length;
  const received = payouts.filter((p) => p.status === "PAID").reduce((s, p) => s + p.amount, 0), owed = payouts.filter((p) => p.status === "PENDING").reduce((s, p) => s + p.amount, 0);
  const roles = software.flatMap((s) => s.assignments.filter((a) => a.userId === S.me.id).map((a) => ({ sw: s.name, r: a.responsibility })));
  const root = h("div", { class: "stack" }, head(`${S.me.name}'s panel`, `${S.users.find((u) => u.id === S.me.id)?.title || ""}`));
  root.append(h("div", { class: "grid g4" }, kpi(String(open.length), "Open tasks"), kpi(`${done}/${mine.length}`, "Tasks done"), kpi(money(received), "Paid to you"), kpi(money(owed), "Owed to you")));
  root.append(h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "My open tasks"), h("a", { href: "#tasks", class: "btn small" }, "Open task board")),
    open.length ? h("ul", { class: "tasks", style: "border-top:0" }, sortTasks(open).map((t) => taskRow(t, { compact: true }))) : h("div", { class: "empty" }, "No open tasks. Nice work.")));
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
    const btn = e.submitter; if (btn) { btn.disabled = true; btn.textContent = "Changing…"; }
    try { await api("/me/password", { method: "POST", body: { currentPassword: cur.value, newPassword: np.value } }); S.me.mustChangePassword = false; toast("Password changed"); location.hash = "#me"; }
    catch (x) { err.textContent = x.message; err.hidden = false; }
    finally { if (btn) { btn.disabled = false; btn.textContent = "Change password"; } }
  } }, err, field(S.me.mustChangePassword ? "Temporary password" : "Current password", cur), field("New password (at least 8 characters)", np), field("Repeat new password", np2), h("div", { class: "actions" }, h("button", { class: "btn primary", type: "submit" }, "Change password")));
  return h("div", { class: "stack" }, head("My account", `${S.me.name} · signed in as ${S.me.username}${isAdmin() ? " · Admin" : ""}`),
    S.me.mustChangePassword ? h("div", { class: "alert" }, h("div", {}, h("b", {}, "Choose your own password. "), "You signed in with a temporary password. Set a new one to open the rest of the panel.")) : null,
    form);
}

boot();

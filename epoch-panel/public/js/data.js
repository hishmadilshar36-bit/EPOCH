// Epoch panel data layer: talks to Supabase.
// It answers the same api("/path") calls the pages used with the old Node server,
// so app.js stays the same. Permissions are enforced in Supabase itself
// (Row Level Security + the team-accounts Edge Function), not here.

const SUPABASE_URL = "https://pghrlsctyifzpnqoghpw.supabase.co";
const SUPABASE_KEY = "sb_publishable_zWbF6AhzKVLSQI6xN3pnEQ_PwyR3AqR"; // publishable key: safe to be public
const EMAIL_DOMAIN = "epoch.invalid"; // usernames are stored as <username>@epoch.invalid

// Sign-in page for this page: the admin panel has its own (index.html#admin)
// The admin panel (admin.html, and its sign-in index.html#admin) keeps its own session,
// separate from the member portal, so both can be signed in on one browser.
const PANEL = document.body?.dataset.mode === "admin" || /^#admin/.test(location.hash) ? "admin" : "work";
const SIGN_IN = () => "index.html" + (PANEL === "admin" ? "#admin" : "");

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: PANEL === "admin" ? "epoch-admin-auth" : "epoch-panel-auth" },
});

const COMPANY = { name: "Epoch", openedOn: "2025-02-02" }; // company opening date / anniversary

const PHASES = [
  { n: 0, title: "Current customers", target: "Collect the remaining balance for City Medical Centre's system and keep the clinic happy.", ongoing: true },
  { n: 1, from: 1, to: 3, title: "Business foundation", target: "Epoch business identity ready." },
  { n: 2, from: 4, to: 7, title: "Build your portfolio", target: "Demos of all our software ready to show customers." },
  { n: 3, from: 8, to: 10, title: "Find potential customers", target: "30 potential customers." },
  { n: 4, from: 11, to: 15, title: "Contact customers", target: "At least 2 serious customer discussions.", note: "Every day: contact 5 businesses. No spam, only relevant and personalised messages." },
  { n: 5, from: 16, to: 20, title: "Close your first sale", target: "First subscription customer signed." },
  { n: 6, from: 21, to: 25, title: "Deliver the project", target: "One completed paid project." },
  { n: 7, from: 26, to: 30, title: "Build recurring income", target: "Second subscription opportunity and first referral." },
];

// ---------- column lists (aliases give the pages the camelCase names they expect) ----------
const SEL = {
  profile: "id,username,name,title,role,active,assignable,seesCustomers:sees_customers,mustChangePassword:must_change_password",
  task: "id,title,phase,status,notes,order:sort_order,assigneeId:assignee_id,dueDate:due_date,createdAt:created_at,updatedAt:updated_at,assignee:profiles!tasks_assignee_id_fkey(id,name)",
  software: "id,name,description,status,createdAt:created_at,assignments(id,userId:user_id,responsibility,user:profiles(id,name)),customers(count)",
  customer: "id,name,contact,phone,email,type,stage,softwareId:software_id,ownerId:owner_id,planId:plan_id,startedAt:started_at,trialEnds:trial_ends,notes,createdAt:created_at,software(id,name),owner:profiles!customers_owner_id_fkey(id,name),plan:plans(id,name,monthlyPrice:monthly_price)",
  payment: "id,customerId:customer_id,kind,amount,period,method,status,dueDate:due_date,paidAt:paid_at,note,createdAt:created_at,customer:customers(id,name),recordedBy:profiles!payments_recorded_by_fkey(id,name)",
  payout: "id,userId:user_id,amount,reason,customerId:customer_id,method,status,dueDate:due_date,paidAt:paid_at,note,createdAt:created_at,user:profiles!payouts_user_id_fkey(id,name),customer:customers(id,name)",
  plan: "id,name,bestFor:best_for,includes,monthlyPrice:monthly_price,annualPrice:annual_price,setupFee:setup_fee,active,order:sort_order,createdAt:created_at,customers(count)",
};

// Fields the pages may send for each table, and their database column names
const COLS = {
  tasks: { title: "title", phase: "phase", status: "status", notes: "notes", assigneeId: "assignee_id", dueDate: "due_date" },
  customers: { name: "name", contact: "contact", phone: "phone", email: "email", type: "type", stage: "stage", softwareId: "software_id", ownerId: "owner_id", planId: "plan_id",
    startedAt: "started_at", trialEnds: "trial_ends", notes: "notes" },
  // price details: admin-only table customer_billing
  billing: { dealType: "deal_type", totalPrice: "total_price", monthlyFee: "monthly_fee" },
  payments: { customerId: "customer_id", kind: "kind", amount: "amount", period: "period", method: "method", status: "status", dueDate: "due_date", paidAt: "paid_at", note: "note" },
  payouts: { userId: "user_id", amount: "amount", reason: "reason", customerId: "customer_id", method: "method", status: "status", dueDate: "due_date", paidAt: "paid_at", note: "note" },
  software: { name: "name", description: "description", status: "status" },
  plans: { name: "name", bestFor: "best_for", includes: "includes", monthlyPrice: "monthly_price", annualPrice: "annual_price", setupFee: "setup_fee", active: "active", order: "sort_order" },
};
const DATE_COLS = new Set(["due_date", "paid_at", "started_at", "trial_ends"]);
function toRow(table, body = {}) {
  const row = {};
  for (const [k, col] of Object.entries(COLS[table])) {
    if (!(k in body) || body[k] === undefined) continue;
    let v = body[k];
    if (typeof v === "string") v = v.trim();
    if (DATE_COLS.has(col) && v === "") v = null;
    row[col] = v;
  }
  return row;
}
const todayISO = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())).toISOString().slice(0, 10); };
const withCount = (rows) => rows.map((r) => { const { customers, ...rest } = r; return { ...rest, _count: { customers: customers?.[0]?.count ?? 0 } }; });

// ---------- errors ----------
function friendly(err) {
  const code = err?.code, msg = err?.message || "";
  if (code === "23505") return new Error("That already exists.");
  if (code === "23503") return new Error("A linked item doesn't exist.");
  if (code === "23514" || code === "22P02") return new Error("Some of those values aren't allowed. Check the form and try again.");
  if (code === "42501") return new Error(/Only the admin/.test(msg) ? msg : "You don't have permission to do that.");
  if (code === "PGRST116") return new Error("That item no longer exists.");
  if (/JWT|session/i.test(msg)) { location.replace(SIGN_IN()); return new Error("Please sign in."); }
  return new Error(msg || "Something went wrong. Check your connection and try again.");
}
async function q(promise) {
  const { data, error } = await promise;
  if (error) throw friendly(error);
  return data;
}
async function teamFn(body) { return callFn("team-accounts", body); }
async function callFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = "Something went wrong.";
    try { msg = (await error.context.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return data;
}

// ---------- session ----------
let ME = null;
async function loadMe() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.replace(SIGN_IN()); throw new Error("Please sign in."); }
  const me = await q(sb.from("profiles").select(SEL.profile).eq("id", session.user.id).maybeSingle());
  if (!me || !me.active) { await sb.auth.signOut(); location.replace(SIGN_IN()); throw new Error("Please sign in."); }
  ME = me;
  return me;
}
// Admin data (money, hosting costs, all tasks' controls) only in the admin panel (admin.html)
const admin = () => ME?.role === "ADMIN" && document.body?.dataset.mode === "admin";

// ---------- the api() the pages call ----------
async function api(path, { method = "GET", body } = {}) {
  if (!ME && path !== "/logout") await loadMe();
  const m = (re) => path.match(re);
  let x;

  // account
  if (path === "/me" && method === "GET") return { user: await loadMe() };
  if (path === "/logout") { await sb.auth.signOut(); ME = null; return { ok: true }; }
  if (path === "/me/password") {
    await teamFn({ action: "change_password", currentPassword: body.currentPassword, newPassword: body.newPassword });
    await loadMe();
    return { ok: true };
  }

  // team
  if (path === "/users" && method === "GET") return q(sb.from("profiles").select(SEL.profile).order("created_at"));
  if (path === "/users" && method === "POST") return teamFn({ action: "create", ...body });
  if ((x = m(/^\/users\/([\w-]+)$/)) && method === "PATCH") return teamFn({ action: "update", id: x[1], ...body });
  if ((x = m(/^\/users\/([\w-]+)\/password$/))) return teamFn({ action: "reset_password", id: x[1], password: body.password });

  // plan
  if (path === "/plan" && method === "GET") {
    const s = await q(sb.from("settings").select("value").eq("key", "planStart").maybeSingle());
    return { start: s?.value || null, phases: PHASES, company: COMPANY };
  }
  if (path === "/plan" && method === "PATCH") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.start || "")) throw new Error("Start date is required.");
    await q(sb.from("settings").upsert({ key: "planStart", value: body.start }));
    return { start: body.start };
  }

  // tasks
  if (path === "/tasks" && method === "GET")
    return q(sb.from("tasks").select(SEL.task).order("phase").order("sort_order").order("id"));
  if (path === "/tasks" && method === "POST") {
    if (!admin()) throw new Error("Only the admin can add tasks.");
    const row = toRow("tasks", body);
    if (!row.title) throw new Error("Task is required.");
    row.phase = 0; // the 30-day plan phases are no longer used
    const last = await q(sb.from("tasks").select("sort_order").order("sort_order", { ascending: false }).limit(1));
    row.sort_order = (last[0]?.sort_order || 0) + 1;
    return q(sb.from("tasks").insert(row).select(SEL.task).single());
  }
  if ((x = m(/^\/tasks\/(\d+)$/))) {
    if (method === "DELETE") return q(sb.from("tasks").delete().eq("id", x[1]));
    const row = toRow("tasks", body);
    if (!admin()) { for (const k of Object.keys(row)) if (!["status", "notes"].includes(k)) delete row[k]; }
    const out = await q(sb.from("tasks").update(row).eq("id", x[1]).select(SEL.task));
    if (!out.length) throw new Error("You can only update tasks assigned to you.");
    return out[0];
  }

  // software
  if (path === "/software" && method === "GET") return withCount(await q(sb.from("software").select(SEL.software).order("id")));
  if (path === "/software" && method === "POST") return q(sb.from("software").insert(toRow("software", body)).select().single());
  if ((x = m(/^\/software\/(\d+)$/))) {
    if (method === "DELETE") return q(sb.from("software").delete().eq("id", x[1]));
    return q(sb.from("software").update(toRow("software", body)).eq("id", x[1]));
  }
  if ((x = m(/^\/software\/(\d+)\/assignments$/)))
    return q(sb.from("assignments").insert({ software_id: Number(x[1]), user_id: body.userId, responsibility: body.responsibility }));
  if ((x = m(/^\/assignments\/(\d+)$/))) return q(sb.from("assignments").delete().eq("id", x[1]));

  // customers
  if (path === "/customers" && method === "GET") {
    const rows = await q(sb.from("customers").select(SEL.customer).order("created_at", { ascending: false }));
    if (admin()) {
      const [money, billing] = await Promise.all([q(sb.rpc("customer_money")), q(sb.from("customer_billing").select("customer_id,deal_type,total_price,monthly_fee"))]);
      const by = Object.fromEntries(money.map((r) => [r.customer_id, r]));
      const bill = Object.fromEntries(billing.map((b) => [b.customer_id, b]));
      for (const c of rows) {
        const b = bill[c.id];
        c.dealType = b?.deal_type || "SUBSCRIPTION"; c.totalPrice = b?.total_price || 0; c.monthlyFee = b?.monthly_fee || 0;
        const r = by[c.id] || { paid: 0, pending: 0 };
        const paid = Number(r.paid), pending = Number(r.pending);
        c.money = { paid, pending, unbilled: c.dealType === "ONE_TIME" ? Math.max(0, c.totalPrice - paid - pending) : 0 };
      }
    }
    return rows;
  }
  if (path === "/customers" && method === "POST") {
    const row = toRow("customers", body);
    if (!row.name) throw new Error("Business name is required.");
    const created = await q(sb.from("customers").insert(row).select(SEL.customer).single());
    if (admin()) await q(sb.from("customer_billing").upsert({ customer_id: created.id, ...toRow("billing", body) }));
    return created;
  }
  if ((x = m(/^\/customers\/(\d+)$/))) {
    if (method === "DELETE") return q(sb.from("customers").delete().eq("id", x[1]));
    const row = toRow("customers", body);
    if (row.name === "") throw new Error("Business name is required.");
    const saved = await q(sb.from("customers").update(row).eq("id", x[1]).select(SEL.customer).single());
    const billing = toRow("billing", body);
    if (admin() && Object.keys(billing).length) await q(sb.from("customer_billing").upsert({ customer_id: Number(x[1]), ...billing }));
    return saved;
  }

  // customer payments (admin) and money split (payouts)
  for (const [route, table] of [["/payments", "payments"], ["/payouts", "payouts"]]) {
    if (path === route && method === "GET") return q(sb.from(table).select(SEL[table.slice(0, -1)]).order("created_at", { ascending: false }));
    if (path === route && method === "POST") {
      const row = toRow(table, body);
      if (table === "payouts" && row.user_id === undefined) row.user_id = null; // company fund
      if (row.status === "PAID" && !row.paid_at) row.paid_at = todayISO();
      if (table === "payments") row.recorded_by = ME.id;
      return q(sb.from(table).insert(row).select(SEL[table.slice(0, -1)]).single());
    }
    if ((x = m(new RegExp(`^${route}/(\\d+)$`)))) {
      if (method === "DELETE") return q(sb.from(table).delete().eq("id", x[1]));
      const row = toRow(table, body);
      if (row.status === "PENDING") row.paid_at = null;
      if (row.status === "PAID" && row.paid_at === undefined) {
        const cur = await q(sb.from(table).select("paid_at").eq("id", x[1]).single());
        if (!cur.paid_at) row.paid_at = todayISO();
      }
      return q(sb.from(table).update(row).eq("id", x[1]).select(SEL[table.slice(0, -1)]).single());
    }
  }
  if (path === "/me/payouts") return q(sb.from("payouts").select(SEL.payout).eq("user_id", ME.id).order("created_at", { ascending: false }));

  // customer emails (sent by the send-email Edge Function from Epoch's Gmail)
  if (path === "/emails/quota") return callFn("send-email", { action: "quota" });
  if (path === "/emails/send") return callFn("send-email", body);
  if ((x = m(/^\/emails\?customer=(\d+)$/)))
    return q(sb.from("emails").select("id,toEmail:to_email,subject,template,status,error,createdAt:created_at,sender:profiles!emails_sent_by_fkey(name)")
      .eq("customer_id", x[1]).order("created_at", { ascending: false }).limit(20));

  // dashboard
  if (path === "/summary") return q(sb.rpc("dashboard_summary"));

  // subscription plans (hosting cost only for the admin)
  if (path === "/plans" && method === "GET") {
    const plans = withCount(await q(sb.from("plans").select(SEL.plan).order("sort_order").order("monthly_price")));
    if (admin()) {
      const costs = await q(sb.from("plan_costs").select("plan_id,hosting_plan,hosting_cost"));
      const by = Object.fromEntries(costs.map((c) => [c.plan_id, c]));
      for (const p of plans) { p.hostingPlan = by[p.id]?.hosting_plan || ""; p.hostingCost = by[p.id]?.hosting_cost || 0; }
    }
    return plans;
  }
  const saveCosts = (id, b) => (b.hostingPlan !== undefined || b.hostingCost !== undefined)
    ? q(sb.from("plan_costs").upsert({ plan_id: id, hosting_plan: (b.hostingPlan || "").trim(), hosting_cost: Number(b.hostingCost) || 0 })) : null;
  if (path === "/plans" && method === "POST") {
    const p = await q(sb.from("plans").insert(toRow("plans", body)).select("id").single());
    await saveCosts(p.id, body);
    return p;
  }
  if ((x = m(/^\/plans\/(\d+)$/))) {
    if (method === "DELETE") return q(sb.from("plans").delete().eq("id", x[1]));
    await q(sb.from("plans").update(toRow("plans", body)).eq("id", x[1]));
    await saveCosts(Number(x[1]), body);
    return { ok: true };
  }

  throw new Error("Not found.");
}

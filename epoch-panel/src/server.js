// Epoch team panel — Express + Prisma API and static frontend.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

// Load .env without an extra dependency
const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const prisma = new PrismaClient();
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SESSION_DAYS = 7;
const COOKIE = "epoch_sid";

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

const ENUMS = {
  role: ["ADMIN", "MEMBER"],
  taskStatus: ["TODO", "DOING", "DONE"],
  softwareStatus: ["READY", "IN_DEVELOPMENT", "PAUSED"],
  responsibility: ["Development", "Design", "Sales", "Support", "Video"],
  customerType: ["Shop", "Restaurant", "Salon", "Clinic", "School", "Other"],
  stage: ["NEW", "CONTACTED", "INTERESTED", "QUOTED", "FREE_TRIAL", "ACTIVE", "SOLD", "LOST"],
  dealType: ["SUBSCRIPTION", "ONE_TIME"],
  paymentKind: ["SETUP", "MONTHLY", "INSTALLMENT", "FULL", "OTHER"],
  paymentMethod: ["CASH", "BANK", "CARD", "OTHER"],
  paymentStatus: ["PENDING", "PAID"],
};

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "same-origin");
  next();
});

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");
const publicUser = (u) => u && ({ id: u.id, username: u.username, name: u.name, title: u.title, role: u.role, active: u.active, mustChangePassword: u.mustChangePassword });

function str(v, field, { max = 500, required = false } = {}) {
  if (v === undefined || v === null) { if (required) throw new HttpError(400, `${field} is required.`); return undefined; }
  if (typeof v !== "string") throw new HttpError(400, `${field} must be text.`);
  const s = v.trim();
  if (required && !s) throw new HttpError(400, `${field} is required.`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters).`);
  return s;
}
function oneOf(v, field, list) {
  if (v === undefined) return undefined;
  if (!list.includes(v)) throw new HttpError(400, `${field} must be one of: ${list.join(", ")}.`);
  return v;
}
function int(v, field, { min = 0, nullable = false } = {}) {
  if (v === undefined) return undefined;
  if (v === null || v === "") { if (nullable) return null; throw new HttpError(400, `${field} is required.`); }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new HttpError(400, `${field} must be a whole number${min ? ` of at least ${min}` : ""}.`);
  return n;
}
function date(v, field) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, `${field} must be a date (YYYY-MM-DD).`);
  const d = new Date(v + "T00:00:00Z");
  if (isNaN(d)) throw new HttpError(400, `${field} is not a valid date.`);
  return d;
}
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
function checkPassword(p) {
  if (typeof p !== "string" || p.length < 8) throw new HttpError(400, "Password must be at least 8 characters.");
  if (p.length > 200) throw new HttpError(400, "Password is too long.");
}
function checkUsername(u) {
  if (typeof u !== "string" || !/^[a-z0-9._-]{3,30}$/.test(u)) throw new HttpError(400, "Username must be 3–30 characters: lowercase letters, numbers, dot, dash or underscore.");
}
async function userExists(id) {
  if (id == null) return;
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) throw new HttpError(400, "That team member doesn't exist.");
}

// Writes must carry a custom header. Browsers can't add it on cross-site
// requests without a CORS preflight, which this server never allows (CSRF guard).
app.use("/api", (req, res, next) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method) && req.get("X-Epoch-Request") !== "1") {
    return res.status(403).json({ error: "Request blocked." });
  }
  next();
});

// ---------- auth ----------
async function loadUser(req, res, next) {
  const token = req.cookies[COOKIE];
  if (token) {
    const s = await prisma.session.findUnique({ where: { id: hashToken(token) }, include: { user: true } });
    if (s && s.expiresAt > new Date() && s.user.active) { req.user = s.user; req.sessionId = s.id; }
  }
  next();
}
app.use("/api", wrap(loadUser));
const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Please sign in." }));
const requireAdmin = (req, res, next) => (req.user?.role === "ADMIN" ? next() : res.status(403).json({ error: "Only the admin can do this." }));
// Until a member sets their own password, only account endpoints work
const requirePasswordSet = (req, res, next) => (req.user?.mustChangePassword ? res.status(403).json({ error: "Set a new password first.", code: "MUST_CHANGE_PASSWORD" }) : next());

const failures = new Map(); // key -> { count, until }
function tooMany(key) {
  const f = failures.get(key);
  return f && f.count >= 5 && f.until > Date.now();
}
function recordFail(key) {
  const f = failures.get(key) || { count: 0, until: 0 };
  f.count = f.until > Date.now() ? f.count + 1 : 1;
  f.until = Date.now() + 15 * 60 * 1000;
  failures.set(key, f);
}

app.post("/api/login", wrap(async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const key = `${req.ip}|${username}`;
  if (tooMany(key)) throw new HttpError(429, "Too many wrong attempts. Wait 15 minutes and try again.");
  const user = await prisma.user.findUnique({ where: { username } });
  const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) { recordFail(key); throw new HttpError(401, "Wrong username or password."); }
  failures.delete(key);
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5) } });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: SESSION_DAYS * 864e5, path: "/" });
  res.json({ user: publicUser(user) });
}));

app.post("/api/logout", wrap(async (req, res) => {
  if (req.sessionId) await prisma.session.deleteMany({ where: { id: req.sessionId } });
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
}));

app.get("/api/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post("/api/me/password", requireAuth, wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!(await bcrypt.compare(String(currentPassword || ""), req.user.passwordHash))) throw new HttpError(400, "Your current password is wrong.");
  checkPassword(newPassword);
  if (newPassword === currentPassword) throw new HttpError(400, "Choose a password different from the current one.");
  await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false } });
  // sign out other devices
  await prisma.session.deleteMany({ where: { userId: req.user.id, NOT: { id: req.sessionId } } });
  res.json({ ok: true });
}));

const api = express.Router();
api.use(requireAuth, requirePasswordSet);

// ---------- team ----------
api.get("/users", wrap(async (req, res) => {
  const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
  res.json(users.map(publicUser));
}));

api.post("/users", requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const username = String(b.username || "").trim().toLowerCase();
  checkUsername(username);
  checkPassword(b.password);
  if (await prisma.user.findUnique({ where: { username } })) throw new HttpError(409, "That username is already taken.");
  const user = await prisma.user.create({ data: {
    username, name: str(b.name, "Name", { max: 80, required: true }), title: str(b.title, "Job title", { max: 120 }) || "",
    role: oneOf(b.role, "Role", ENUMS.role) || "MEMBER", passwordHash: await bcrypt.hash(b.password, 12), mustChangePassword: true,
  } });
  res.status(201).json(publicUser(user));
}));

api.patch("/users/:id", requireAdmin, wrap(async (req, res) => {
  const id = int(req.params.id, "id", { min: 1 });
  const b = req.body || {};
  const data = clean({ name: str(b.name, "Name", { max: 80 }), title: str(b.title, "Job title", { max: 120 }), role: oneOf(b.role, "Role", ENUMS.role), active: typeof b.active === "boolean" ? b.active : undefined });
  if (data.name === "") throw new HttpError(400, "Name is required.");
  if (id === req.user.id && (data.role === "MEMBER" || data.active === false)) throw new HttpError(400, "You can't remove your own admin access.");
  const user = await prisma.user.update({ where: { id }, data });
  if (data.active === false) await prisma.session.deleteMany({ where: { userId: id } });
  res.json(publicUser(user));
}));

api.post("/users/:id/password", requireAdmin, wrap(async (req, res) => {
  const id = int(req.params.id, "id", { min: 1 });
  checkPassword(req.body?.password);
  await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(req.body.password, 12), mustChangePassword: true } });
  await prisma.session.deleteMany({ where: { userId: id } });
  res.json({ ok: true });
}));

// ---------- plan & tasks ----------
async function planStart() {
  const s = await prisma.setting.findUnique({ where: { key: "planStart" } });
  return s ? s.value : null;
}
api.get("/plan", wrap(async (req, res) => res.json({ start: await planStart(), phases: PHASES, company: COMPANY })));
api.patch("/plan", requireAdmin, wrap(async (req, res) => {
  const d = date(req.body?.start, "Start date");
  if (!d) throw new HttpError(400, "Start date is required.");
  const value = req.body.start;
  await prisma.setting.upsert({ where: { key: "planStart" }, update: { value }, create: { key: "planStart", value } });
  res.json({ start: value });
}));

const taskInclude = { assignee: { select: { id: true, name: true } } };
// Members get only their own tasks plus whole-team (unassigned) ones; the admin gets everything.
api.get("/tasks", wrap(async (req, res) => {
  const where = req.user.role === "ADMIN" ? {} : { OR: [{ assigneeId: req.user.id }, { assigneeId: null }] };
  res.json(await prisma.task.findMany({ where, include: taskInclude, orderBy: [{ phase: "asc" }, { order: "asc" }, { id: "asc" }] }));
}));

api.post("/tasks", wrap(async (req, res) => {
  const b = req.body || {};
  const phase = int(b.phase, "Phase");
  if (!PHASES.some((p) => p.n === phase)) throw new HttpError(400, "Unknown phase.");
  let assigneeId = int(b.assigneeId, "Assignee", { min: 1, nullable: true });
  if (req.user.role !== "ADMIN") assigneeId = req.user.id; // members add tasks for themselves
  await userExists(assigneeId);
  const last = await prisma.task.findFirst({ where: { phase }, orderBy: { order: "desc" } });
  const task = await prisma.task.create({ data: { title: str(b.title, "Task", { max: 300, required: true }), phase, assigneeId: assigneeId ?? null, notes: str(b.notes, "Notes", { max: 2000 }) || "", dueDate: date(b.dueDate, "Due date") ?? null, order: (last?.order || 0) + 1 }, include: taskInclude });
  res.status(201).json(task);
}));

api.patch("/tasks/:id", wrap(async (req, res) => {
  const id = int(req.params.id, "id", { min: 1 });
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) throw new HttpError(404, "Task not found.");
  const b = req.body || {};
  const isAdmin = req.user.role === "ADMIN";
  if (!isAdmin && task.assigneeId !== req.user.id) throw new HttpError(403, "You can only update tasks assigned to you.");
  const data = clean({ status: oneOf(b.status, "Status", ENUMS.taskStatus), notes: str(b.notes, "Notes", { max: 2000 }) });
  if (isAdmin) {
    Object.assign(data, clean({ title: str(b.title, "Task", { max: 300 }), assigneeId: int(b.assigneeId, "Assignee", { min: 1, nullable: true }), dueDate: date(b.dueDate, "Due date") }));
    if (data.title === "") throw new HttpError(400, "Task is required.");
    if (b.phase !== undefined) { const p = int(b.phase, "Phase"); if (!PHASES.some((x) => x.n === p)) throw new HttpError(400, "Unknown phase."); data.phase = p; }
    await userExists(data.assigneeId);
  }
  res.json(await prisma.task.update({ where: { id }, data, include: taskInclude }));
}));

api.delete("/tasks/:id", requireAdmin, wrap(async (req, res) => {
  await prisma.task.delete({ where: { id: int(req.params.id, "id", { min: 1 }) } });
  res.json({ ok: true });
}));

// ---------- software & assignments ----------
api.get("/software", wrap(async (req, res) => {
  res.json(await prisma.software.findMany({
    orderBy: { id: "asc" },
    include: { assignments: { include: { user: { select: { id: true, name: true } } }, orderBy: { id: "asc" } }, _count: { select: { customers: true } } },
  }));
}));
api.post("/software", requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, "Name", { max: 100, required: true });
  if (await prisma.software.findUnique({ where: { name } })) throw new HttpError(409, "Software with that name already exists.");
  res.status(201).json(await prisma.software.create({ data: { name, description: str(b.description, "Description", { max: 1000 }) || "", status: oneOf(b.status, "Status", ENUMS.softwareStatus) || "READY" } }));
}));
api.patch("/software/:id", requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const data = clean({ name: str(b.name, "Name", { max: 100 }), description: str(b.description, "Description", { max: 1000 }), status: oneOf(b.status, "Status", ENUMS.softwareStatus) });
  if (data.name === "") throw new HttpError(400, "Name is required.");
  res.json(await prisma.software.update({ where: { id: int(req.params.id, "id", { min: 1 }) }, data }));
}));
api.delete("/software/:id", requireAdmin, wrap(async (req, res) => {
  await prisma.software.delete({ where: { id: int(req.params.id, "id", { min: 1 }) } });
  res.json({ ok: true });
}));
api.post("/software/:id/assignments", requireAdmin, wrap(async (req, res) => {
  const softwareId = int(req.params.id, "id", { min: 1 });
  const userId = int(req.body?.userId, "Team member", { min: 1 });
  await userExists(userId);
  const responsibility = oneOf(req.body?.responsibility, "Responsibility", ENUMS.responsibility);
  if (!responsibility) throw new HttpError(400, "Responsibility is required.");
  const exists = await prisma.assignment.findUnique({ where: { softwareId_userId_responsibility: { softwareId, userId, responsibility } } });
  if (exists) throw new HttpError(409, "That person already has this responsibility.");
  res.status(201).json(await prisma.assignment.create({ data: { softwareId, userId, responsibility } }));
}));
api.delete("/assignments/:id", requireAdmin, wrap(async (req, res) => {
  await prisma.assignment.delete({ where: { id: int(req.params.id, "id", { min: 1 }) } });
  res.json({ ok: true });
}));

// ---------- customers ----------
const customerInclude = { software: { select: { id: true, name: true } }, owner: { select: { id: true, name: true } }, plan: { select: { id: true, name: true, monthlyPrice: true } } };
function customerData(b) {
  return clean({
    name: str(b.name, "Business name", { max: 150 }), contact: str(b.contact, "Contact person", { max: 150 }), phone: str(b.phone, "Phone", { max: 60 }),
    type: oneOf(b.type, "Type", ENUMS.customerType), stage: oneOf(b.stage, "Stage", ENUMS.stage),
    softwareId: int(b.softwareId, "Software", { min: 1, nullable: true }), ownerId: int(b.ownerId, "Handled by", { min: 1, nullable: true }),
    dealType: oneOf(b.dealType, "Deal type", ENUMS.dealType), totalPrice: int(b.totalPrice, "Full price"),
    planId: int(b.planId, "Plan", { min: 1, nullable: true }),
    monthlyFee: int(b.monthlyFee, "Monthly fee"), startedAt: date(b.startedAt, "Start date"), trialEnds: date(b.trialEnds, "Free period end"),
    notes: str(b.notes, "Notes", { max: 3000 }),
  });
}
// Paid / pending totals per customer (admin only)
async function customerMoney() {
  const rows = await prisma.payment.groupBy({ by: ["customerId", "status"], _sum: { amount: true } });
  const m = {};
  for (const r of rows) { m[r.customerId] ||= { paid: 0, pending: 0 }; m[r.customerId][r.status === "PAID" ? "paid" : "pending"] += r._sum.amount || 0; }
  return m;
}
api.get("/customers", wrap(async (req, res) => {
  const customers = await prisma.customer.findMany({ include: customerInclude, orderBy: { createdAt: "desc" } });
  if (req.user.role === "ADMIN") {
    const m = await customerMoney();
    for (const c of customers) {
      const x = m[c.id] || { paid: 0, pending: 0 };
      c.money = { ...x, unbilled: c.dealType === "ONE_TIME" ? Math.max(0, c.totalPrice - x.paid - x.pending) : 0 };
    }
  }
  res.json(customers);
}));
api.post("/customers", wrap(async (req, res) => {
  const data = customerData(req.body || {});
  if (!data.name) throw new HttpError(400, "Business name is required.");
  await userExists(data.ownerId);
  res.status(201).json(await prisma.customer.create({ data, include: customerInclude }));
}));
api.patch("/customers/:id", wrap(async (req, res) => {
  const data = customerData(req.body || {});
  if (data.name === "") throw new HttpError(400, "Business name is required.");
  await userExists(data.ownerId);
  res.json(await prisma.customer.update({ where: { id: int(req.params.id, "id", { min: 1 }) }, data, include: customerInclude }));
}));
api.delete("/customers/:id", requireAdmin, wrap(async (req, res) => {
  await prisma.customer.delete({ where: { id: int(req.params.id, "id", { min: 1 }) } });
  res.json({ ok: true });
}));

// ---------- payments (admin only) ----------
const paymentInclude = { customer: { select: { id: true, name: true } }, recordedBy: { select: { id: true, name: true } } };
function paymentData(b) {
  return clean({
    customerId: int(b.customerId, "Customer", { min: 1 }), kind: oneOf(b.kind, "Type", ENUMS.paymentKind), amount: int(b.amount, "Amount", { min: 0 }),
    period: str(b.period, "Period", { max: 40 }), method: oneOf(b.method, "Method", ENUMS.paymentMethod), status: oneOf(b.status, "Status", ENUMS.paymentStatus),
    dueDate: date(b.dueDate, "Due date"), paidAt: date(b.paidAt, "Paid on"), note: str(b.note, "Note", { max: 1000 }),
  });
}
api.get("/payments", requireAdmin, wrap(async (req, res) => {
  res.json(await prisma.payment.findMany({ include: paymentInclude, orderBy: [{ createdAt: "desc" }] }));
}));
api.post("/payments", requireAdmin, wrap(async (req, res) => {
  const data = paymentData(req.body || {});
  if (!data.customerId) throw new HttpError(400, "Customer is required.");
  if (data.amount === undefined) throw new HttpError(400, "Amount is required.");
  if (data.status === "PAID" && !data.paidAt) data.paidAt = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  res.status(201).json(await prisma.payment.create({ data: { ...data, recordedById: req.user.id }, include: paymentInclude }));
}));
api.patch("/payments/:id", requireAdmin, wrap(async (req, res) => {
  const data = paymentData(req.body || {});
  if (data.status === "PAID" && data.paidAt === undefined) {
    const cur = await prisma.payment.findUnique({ where: { id: int(req.params.id, "id", { min: 1 }) } });
    if (cur && !cur.paidAt) data.paidAt = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  }
  if (data.status === "PENDING") data.paidAt = null;
  res.json(await prisma.payment.update({ where: { id: int(req.params.id, "id", { min: 1 }) }, data, include: paymentInclude }));
}));
api.delete("/payments/:id", requireAdmin, wrap(async (req, res) => {
  await prisma.payment.delete({ where: { id: int(req.params.id, "id", { min: 1 }) } });
  res.json({ ok: true });
}));

// ---------- subscription plans (everyone reads; admin edits; hosting cost is admin-only) ----------
function planData(b) {
  const data = clean({
    name: str(b.name, "Plan name", { max: 80 }), bestFor: str(b.bestFor, "Best for", { max: 200 }), includes: str(b.includes, "What's included", { max: 3000 }),
    monthlyPrice: int(b.monthlyPrice, "Monthly price"), annualPrice: int(b.annualPrice, "Yearly price"), setupFee: int(b.setupFee, "Setup fee"),
    hostingPlan: str(b.hostingPlan, "Hosting package", { max: 80 }), hostingCost: int(b.hostingCost, "Hosting cost"),
    active: typeof b.active === "boolean" ? b.active : undefined, order: int(b.order, "Order"),
  });
  if (data.name === "") throw new HttpError(400, "Plan name is required.");
  return data;
}
api.get("/plans", wrap(async (req, res) => {
  const plans = await prisma.plan.findMany({ orderBy: [{ order: "asc" }, { monthlyPrice: "asc" }], include: { _count: { select: { customers: true } } } });
  if (req.user.role !== "ADMIN") for (const p of plans) { delete p.hostingCost; delete p.hostingPlan; }
  res.json(plans);
}));
api.post("/plans", requireAdmin, wrap(async (req, res) => {
  const data = planData(req.body || {});
  if (!data.name) throw new HttpError(400, "Plan name is required.");
  res.status(201).json(await prisma.plan.create({ data }));
}));
api.patch("/plans/:id", requireAdmin, wrap(async (req, res) => {
  res.json(await prisma.plan.update({ where: { id: int(req.params.id, "id", { min: 1 }) }, data: planData(req.body || {}) }));
}));
api.delete("/plans/:id", requireAdmin, wrap(async (req, res) => {
  await prisma.plan.delete({ where: { id: int(req.params.id, "id", { min: 1 }) } });
  res.json({ ok: true });
}));

// ---------- team payouts (admin manages, each member sees their own) ----------
const payoutInclude = { user: { select: { id: true, name: true } }, customer: { select: { id: true, name: true } } };
async function payoutData(b) {
  const data = clean({
    userId: int(b.userId, "Paid to", { min: 1, nullable: true }), amount: int(b.amount, "Amount"), reason: str(b.reason, "What it's for", { max: 200 }),
    customerId: int(b.customerId, "Customer", { min: 1, nullable: true }), method: oneOf(b.method, "Method", ENUMS.paymentMethod),
    status: oneOf(b.status, "Status", ENUMS.paymentStatus), dueDate: date(b.dueDate, "Due date"), paidAt: date(b.paidAt, "Paid on"), note: str(b.note, "Note", { max: 1000 }),
  });
  if (data.reason === "") throw new HttpError(400, "Say what the payment is for.");
  await userExists(data.userId);
  return data;
}
const todayDate = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
api.get("/payouts", requireAdmin, wrap(async (req, res) => {
  res.json(await prisma.payout.findMany({ include: payoutInclude, orderBy: { createdAt: "desc" } }));
}));
api.get("/me/payouts", wrap(async (req, res) => {
  res.json(await prisma.payout.findMany({ where: { userId: req.user.id }, include: payoutInclude, orderBy: { createdAt: "desc" } }));
}));
api.post("/payouts", requireAdmin, wrap(async (req, res) => {
  const data = await payoutData(req.body || {});
  if (data.userId === undefined) data.userId = null; // company fund
  if (data.amount === undefined) throw new HttpError(400, "Amount is required.");
  if (!data.reason) throw new HttpError(400, "Say what the payment is for.");
  if (data.status === "PAID" && !data.paidAt) data.paidAt = todayDate();
  res.status(201).json(await prisma.payout.create({ data, include: payoutInclude }));
}));
api.patch("/payouts/:id", requireAdmin, wrap(async (req, res) => {
  const id = int(req.params.id, "id", { min: 1 });
  const data = await payoutData(req.body || {});
  if (data.status === "PAID" && data.paidAt === undefined) data.paidAt = todayDate();
  if (data.status === "PENDING") data.paidAt = null;
  res.json(await prisma.payout.update({ where: { id }, data, include: payoutInclude }));
}));
api.delete("/payouts/:id", requireAdmin, wrap(async (req, res) => {
  await prisma.payout.delete({ where: { id: int(req.params.id, "id", { min: 1 }) } });
  res.json({ ok: true });
}));

// ---------- dashboard ----------
api.get("/summary", wrap(async (req, res) => {
  const [tasks, users, customers] = await Promise.all([
    prisma.task.findMany({ select: { status: true, assigneeId: true, phase: true } }),
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, title: true, role: true } }),
    prisma.customer.findMany({ include: { software: { select: { name: true } } } }),
  ]);
  const people = users.map((u) => {
    const mine = tasks.filter((t) => t.assigneeId === u.id);
    return { ...u, total: mine.length, done: mine.filter((t) => t.status === "DONE").length, doing: mine.filter((t) => t.status === "DOING").length };
  });
  const trials = customers.filter((c) => c.stage === "FREE_TRIAL").map((c) => ({ id: c.id, name: c.name, software: c.software?.name || "", trialEnds: c.trialEnds }));
  const out = {
    tasks: { total: tasks.length, done: tasks.filter((t) => t.status === "DONE").length },
    people, trials,
    pipeline: Object.fromEntries(ENUMS.stage.map((s) => [s, customers.filter((c) => c.stage === s).length])),
  };
  if (req.user.role === "ADMIN") {
    const [payments, payouts, m] = await Promise.all([
      prisma.payment.findMany({ select: { amount: true, status: true, dueDate: true } }),
      prisma.payout.findMany({ select: { amount: true, status: true, userId: true } }),
      customerMoney(),
    ]);
    const today = todayDate();
    const sum = (a) => a.reduce((s, x) => s + x.amount, 0);
    out.money = {
      mrr: customers.filter((c) => c.stage === "ACTIVE" && c.dealType !== "ONE_TIME").reduce((s, c) => s + c.monthlyFee, 0),
      collected: sum(payments.filter((p) => p.status === "PAID")),
      pending: sum(payments.filter((p) => p.status === "PENDING")),
      unbilled: customers.filter((c) => c.dealType === "ONE_TIME").reduce((s, c) => { const x = m[c.id] || { paid: 0, pending: 0 }; return s + Math.max(0, c.totalPrice - x.paid - x.pending); }, 0),
      overdue: payments.filter((p) => p.status === "PENDING" && p.dueDate && p.dueDate < today).length,
      paidToTeam: sum(payouts.filter((p) => p.status === "PAID" && p.userId)),
      owedToTeam: sum(payouts.filter((p) => p.status === "PENDING" && p.userId)),
      companyFund: sum(payouts.filter((p) => p.status === "PAID" && !p.userId)),
      companyPlanned: sum(payouts.filter((p) => p.status === "PENDING" && !p.userId)),
    };
    // Money customers paid that hasn't been given to the team or put into the company fund yet
    out.money.unsplit = out.money.collected - out.money.paidToTeam - out.money.companyFund;
  }
  res.json(out);
}));

api.get("/enums", (req, res) => res.json(ENUMS));

app.use("/api", api);
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

// ---------- static frontend ----------
app.use(express.static(path.join(__dirname, "..", "public"), { extensions: ["html"] }));

// ---------- errors ----------
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Request body isn't valid JSON." });
  if (err?.code === "P2025") return res.status(404).json({ error: "That item no longer exists." });
  if (err?.code === "P2002") return res.status(409).json({ error: "That already exists." });
  if (err?.code === "P2003") return res.status(400).json({ error: "A linked item doesn't exist." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => console.log(`Epoch panel running at http://localhost:${PORT}`));

// Remove expired sessions once an hour
setInterval(() => prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {}), 3600e3).unref();

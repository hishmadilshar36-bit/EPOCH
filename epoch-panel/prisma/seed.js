// Seeds the Epoch team, software, first customer and the 30-day plan.
// Safe to run again: existing users keep their passwords, and tasks are only
// created when the board is empty.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const PLAN_START = "2026-11-18";

const TEAM = [
  { username: "hishma", name: "Hishma", title: "MD · UI/UX designer · Business lead", role: "ADMIN" },
  { username: "hansa", name: "Hansa", title: "Founder · Client communication & calls", role: "MEMBER" },
  { username: "ravindu", name: "Ravindu", title: "Developer · Video editor", role: "MEMBER" },
];

const SOFTWARE = [
  { name: "Clinic Medical System", description: "Patient records, appointments and billing for clinics and doctors.", status: "READY",
    team: [["ravindu", "Development"], ["hishma", "Design"], ["hansa", "Sales"], ["ravindu", "Support"]] },
  { name: "E-commerce Website", description: "Online store for retail shops: products, cart, orders and payments.", status: "READY",
    team: [["ravindu", "Development"], ["hishma", "Design"], ["hansa", "Sales"]] },
  { name: "Smart POS System", description: "Point-of-sale billing and stock control for shops.", status: "READY",
    team: [["ravindu", "Development"], ["hishma", "Design"], ["hansa", "Sales"]] },
  { name: "Business Website", description: "Websites for restaurants, salons and small businesses.", status: "READY",
    team: [["hishma", "Design"], ["ravindu", "Development"], ["hansa", "Sales"], ["ravindu", "Video"]] },
];

// [phase, assignee, title, notes]
const TASKS = [
  [0, "hansa", "Collect the pending Rs. 75,000 from Dr. Athula", "Record it on Customer payments when received"],
  [0, "hishma", "Send Dr. Athula a written statement: Rs. 250,000 total, Rs. 165,000 paid, balance due", ""],
  [0, "hansa", "Confirm what the 3-month free period covers and what happens after 22 Dec 2026", "e.g. offer a yearly support plan"],
  [0, "hishma", "Check how the clinic uses the system and collect Dr. Athula's feedback", ""],
  [0, "ravindu", "Fix issues and requests raised during the free period", ""],
  [0, "hansa", "Ask Dr. Athula for a testimonial and referrals to other clinics", ""],

  [1, null, "Finalize Epoch's services", "Whole team"],
  [1, "hishma", "Create a professional Facebook page", ""],
  [1, "hansa", "Create WhatsApp Business profile", ""],
  [1, "hishma", "Define subscription packages and monthly prices", ""],
  [1, "hishma", "Write subscription terms: what's included, minimum term, cancellation", ""],
  [1, "hansa", "Choose how to collect monthly payments (bank transfer, standing order, reminders)", ""],
  [1, "ravindu", "Create a professional email address", ""],

  [2, "hishma", "Design UI for the restaurant demo website", ""],
  [2, "ravindu", "Build the restaurant demo website", ""],
  [2, "ravindu", "Set up the e-commerce site as the retail shop demo", ""],
  [2, "ravindu", "Prepare a demo of the Clinic Medical System (screenshots + video)", ""],
  [2, "ravindu", "Prepare a demo of the Smart POS System (screenshots + video)", ""],
  [2, "hishma", "Add screenshots, features and contact information to the demos", ""],

  [3, "hansa", "Find 30 small businesses (shops, restaurants, salons, clinics)", "Add each one on the Customers page"],
  [3, "hishma", "Check which have no website or an outdated one", ""],
  [3, "hansa", "Complete the list with business name and contact details", ""],

  [4, "hishma", "Write personalised message templates (what we can improve)", "Pitch the monthly subscription: low upfront cost, hosting and updates included"],
  [4, "hansa", "Contact 5 businesses every day", "Update each customer's stage"],
  [4, "hansa", "Show demos and ask whether they need a website or system", ""],

  [5, "hansa", "Discuss requirements with the customer", ""],
  [5, "hishma", "Send a written subscription proposal (package, monthly fee, minimum term)", ""],
  [5, "hansa", "Agree on the delivery date", ""],
  [5, "hansa", "Sign the subscription agreement", ""],
  [5, "hansa", "Collect setup fee and first month's subscription", "Record it on the Payments page"],
  [5, "ravindu", "Start development", ""],

  [6, "ravindu", "Complete the project", ""],
  [6, "hishma", "Test mobile responsiveness", ""],
  [6, "ravindu", "Test contact forms and links", ""],
  [6, "hansa", "Get customer approval", ""],
  [6, "hansa", "Start monthly billing and send the first invoice", ""],
  [6, "hansa", "Request a testimonial", ""],

  [7, "hansa", "Offer the first subscriber a package upgrade or add-ons", ""],
  [7, "hansa", "Contact another 20 businesses", ""],
  [7, "hishma", "Publish the completed project (portfolio + Facebook)", ""],
  [7, "hansa", "Ask the first customer for referrals", ""],
  [7, "hishma", "Interview 3 retail shop owners about stock and billing problems", "Use what you learn to shape and pitch the Smart POS System"],
];

function tempPassword() {
  // 12 chars, no look-alike characters
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(12), (b) => chars[b % chars.length]).join("");
}

async function main() {
  const created = [];
  const ids = {};
  for (const m of TEAM) {
    let u = await prisma.user.findUnique({ where: { username: m.username } });
    if (!u) {
      const pw = tempPassword();
      u = await prisma.user.create({ data: { ...m, passwordHash: await bcrypt.hash(pw, 12), mustChangePassword: true } });
      created.push(`${m.name.padEnd(8)} username: ${m.username.padEnd(8)} temporary password: ${pw}`);
    }
    ids[m.username] = u.id;
  }

  for (const s of SOFTWARE) {
    const sw = await prisma.software.upsert({ where: { name: s.name }, update: {}, create: { name: s.name, description: s.description, status: s.status } });
    for (const [username, responsibility] of s.team) {
      await prisma.assignment.upsert({
        where: { softwareId_userId_responsibility: { softwareId: sw.id, userId: ids[username], responsibility } },
        update: {}, create: { softwareId: sw.id, userId: ids[username], responsibility },
      });
    }
  }

  await prisma.setting.upsert({ where: { key: "planStart" }, update: {}, create: { key: "planStart", value: PLAN_START } });

  if ((await prisma.task.count()) === 0) {
    const order = {};
    for (const [phase, who, title, notes] of TASKS) {
      order[phase] = (order[phase] || 0) + 1;
      await prisma.task.create({ data: { phase, title, notes, order: order[phase], assigneeId: who ? ids[who] : null } });
    }
  }

  if (!(await prisma.customer.findFirst({ where: { name: "City Medical Centre" } }))) {
    const clinic = await prisma.software.findUnique({ where: { name: "Clinic Medical System" } });
    const cmc = await prisma.customer.create({ data: {
      name: "City Medical Centre", contact: "Dr. Athula", type: "Clinic", stage: "SOLD", dealType: "ONE_TIME", totalPrice: 250000,
      softwareId: clinic.id, ownerId: ids.hansa, startedAt: new Date("2026-09-22T00:00:00Z"), trialEnds: new Date("2026-12-22T00:00:00Z"),
      notes: "Matale. First Epoch customer. Clinic Medical System runs locally (localhost) on the clinic's computer. One-time sale, Rs. 250,000 full price. Installed 22 Sep 2026 with a 3-month free period.",
    } });
    await prisma.payment.createMany({ data: [
      { customerId: cmc.id, kind: "INSTALLMENT", amount: 165000, status: "PAID", method: "OTHER", note: "Paid by Dr. Athula. Payment date not recorded.", recordedById: ids.hishma },
      { customerId: cmc.id, kind: "INSTALLMENT", amount: 75000, status: "PENDING", method: "OTHER", note: "Balance pending from Dr. Athula.", recordedById: ids.hishma },
    ] });
  }

  if (created.length) {
    const file = path.join(__dirname, "initial-passwords.txt");
    fs.writeFileSync(file, [
      "Epoch panel: first sign-in details. Give each person only their own line,",
      "then delete this file. Everyone must choose a new password at first sign-in.",
      "", ...created, "",
    ].join("\n"), { mode: 0o600 });
    console.log(`Created ${created.length} team account(s). Temporary passwords saved to prisma/initial-passwords.txt`);
  } else {
    console.log("Team accounts already exist; passwords unchanged.");
  }
  console.log("Seed complete.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

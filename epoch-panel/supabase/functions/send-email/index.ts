// Epoch panel: send an email to a customer from Epoch's Gmail account.
// - Only signed-in, active team members can send.
// - Only to the email address saved on the customer (no free-typed addresses).
// - Optional daily cap: set `emailDailyLimit` in settings (Sri Lanka time). No setting = no limit
//   (Gmail itself allows about 500 a day).
// - Every attempt is logged in public.emails.
// Needs the Supabase secret GMAIL_APP_PASSWORD (Edge Functions → Secrets): a Gmail App Password,
// not the normal Gmail password. Uses Gmail SMTP on port 465 (Supabase blocks 25 and 587).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.16";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => reply(status, { error, ...extra });

// Start of today in Sri Lanka (UTC+5:30), as a UTC timestamp
function startOfColomboDay(): string {
  const offset = 330 * 60 * 1000;
  const local = new Date(Date.now() + offset);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset;
  return new Date(midnight).toISOString();
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
function htmlBody(text: string): string {
  const paras = esc(text).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#15191f;max-width:600px">
${paras}
<hr style="border:0;border-top:1px solid #d8dde6;margin:22px 0 10px">
<p style="margin:0;font-size:12px;color:#5a616d"><b style="color:#0d47a1;letter-spacing:.08em">EPOCH</b> · Empowering possibilities through technology</p>
</div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "Use POST.");

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await db.auth.getUser(jwt);
  if (!who?.user) return fail(401, "Please sign in.");
  const { data: me } = await db.from("profiles").select("id,active,must_change_password").eq("id", who.user.id).single();
  if (!me || !me.active || me.must_change_password) return fail(403, "You can't send emails from this account.");

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail(400, "Request body isn't valid JSON."); }

  const { data: settingRows } = await db.from("settings").select("key,value").in("key", ["emailFrom", "emailReplyTo", "emailDailyLimit", "emailGmailUser"]);
  const settings = Object.fromEntries((settingRows || []).map((r) => [r.key, r.value]));
  const limit = settings.emailDailyLimit ? Math.max(0, Number(settings.emailDailyLimit) || 0) : null; // null = no limit
  const { count: sentToday } = await db.from("emails").select("id", { count: "exact", head: true })
    .eq("status", "SENT").gte("created_at", startOfColomboDay());
  const used = sentToday ?? 0;

  const gmailUser = settings.emailGmailUser || "";
  const appPassword = (Deno.env.get("GMAIL_APP_PASSWORD") || "").replace(/\s+/g, "");
  if (body.action === "quota") return reply(200, { limit, used, left: limit == null ? null : Math.max(0, limit - used), ready: !!(appPassword && gmailUser) });

  if (!appPassword || !gmailUser) return fail(503, "Email isn't set up yet. Add the Gmail App Password in Supabase (Edge Functions → Secrets → GMAIL_APP_PASSWORD).");
  if (limit != null && used >= limit) return fail(429, `Today's limit of ${limit} emails is used up. Try again tomorrow.`, { limit, used, left: 0 });

  const customerId = Number(body.customerId);
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const template = typeof body.template === "string" ? body.template.slice(0, 40) : "";
  if (!Number.isInteger(customerId) || customerId < 1) return fail(400, "Choose a customer.");
  if (!subject || subject.length > 150) return fail(400, "Subject is required (max 150 characters).");
  if (!message || message.length > 5000) return fail(400, "Message is required (max 5,000 characters).");

  const { data: customer } = await db.from("customers").select("id,name,email").eq("id", customerId).maybeSingle();
  if (!customer) return fail(404, "That customer doesn't exist.");
  if (!customer.email) return fail(400, "Add an email address to this customer first.");

  let messageId: string | null = null, error: string | null = null;
  try {
    const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: gmailUser, pass: appPassword } });
    const info = await transport.sendMail({
      from: settings.emailFrom || `Epoch <${gmailUser}>`,
      to: customer.email,
      replyTo: settings.emailReplyTo || gmailUser,
      subject,
      text: message,
      html: htmlBody(message),
    });
    messageId = info?.messageId || "sent";
  } catch (e) {
    error = String((e as Error)?.message || e).slice(0, 500);
  }
  await db.from("emails").insert({
    customer_id: customer.id, to_email: customer.email, subject, body: message, template, sent_by: me.id,
    status: messageId ? "SENT" : "FAILED", provider_id: messageId, error,
  });
  if (!messageId) {
    const hint = /auth|535|534|password|credentials/i.test(error || "")
      ? " Gmail refused the sign-in: check GMAIL_APP_PASSWORD is a Gmail App Password and 2-Step Verification is on."
      : "";
    return fail(502, `Gmail didn't send it: ${error}.${hint}`);
  }
  return reply(200, { ok: true, id: messageId, limit, used: used + 1, left: limit == null ? null : Math.max(0, limit - used - 1) });
});

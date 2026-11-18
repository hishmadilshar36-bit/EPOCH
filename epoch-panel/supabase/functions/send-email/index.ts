// Epoch panel: send an email to a customer through Resend.
// - Only signed-in, active team members can send.
// - Only to the email address saved on the customer (no free-typed addresses).
// - At most `emailDailyLimit` emails per day (Sri Lanka time), default 5.
// - Every attempt is logged in public.emails.
// Needs the Supabase secret RESEND_API_KEY (Edge Functions → Secrets).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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

  const { data: settingRows } = await db.from("settings").select("key,value").in("key", ["emailFrom", "emailReplyTo", "emailDailyLimit"]);
  const settings = Object.fromEntries((settingRows || []).map((r) => [r.key, r.value]));
  const limit = Math.max(0, Number(settings.emailDailyLimit ?? 5) || 0);
  const { count: sentToday } = await db.from("emails").select("id", { count: "exact", head: true })
    .eq("status", "SENT").gte("created_at", startOfColomboDay());
  const used = sentToday ?? 0;

  if (body.action === "quota") return reply(200, { limit, used, left: Math.max(0, limit - used), ready: !!Deno.env.get("RESEND_API_KEY") });

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return fail(503, "Email isn't set up yet. Add the Resend API key in Supabase (Edge Functions → Secrets → RESEND_API_KEY).");
  if (used >= limit) return fail(429, `Today's limit of ${limit} emails is used up. Try again tomorrow.`, { limit, used, left: 0 });

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

  const payload: Record<string, unknown> = {
    from: settings.emailFrom || "Epoch <onboarding@resend.dev>",
    to: [customer.email],
    subject,
    text: message,
    html: htmlBody(message),
  };
  if (settings.emailReplyTo) payload.reply_to = settings.emailReplyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(() => ({}));
  const ok = res.ok && out?.id;
  await db.from("emails").insert({
    customer_id: customer.id, to_email: customer.email, subject, body: message, template, sent_by: me.id,
    status: ok ? "SENT" : "FAILED", provider_id: ok ? out.id : null, error: ok ? null : String(out?.message || res.statusText).slice(0, 500),
  });
  if (!ok) {
    const why = String(out?.message || "");
    const hint = /domain|testing emails|own email/i.test(why)
      ? " Resend only delivers to other people once you verify your own domain in Resend."
      : "";
    return fail(502, `Resend didn't send it: ${why || res.statusText}.${hint}`);
  }
  return reply(200, { ok: true, id: out.id, limit, used: used + 1, left: Math.max(0, limit - used - 1) });
});

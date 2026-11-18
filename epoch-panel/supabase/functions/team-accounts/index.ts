// Epoch panel: team account actions that need Supabase's admin powers.
// - change_password (anyone signed in): check the current password, set a new one
// - create, update, reset_password (admin only): manage team logins
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const EMAIL_DOMAIN = "epoch.invalid"; // usernames are stored as <username>@epoch.invalid
const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (status: number, error: string) => reply(status, { error });

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

function checkPassword(p: unknown): string | null {
  if (typeof p !== "string" || p.length < 8) return "Password must be at least 8 characters.";
  if (p.length > 72) return "Password is too long (max 72 characters).";
  return null;
}
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "Use POST.");

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !who?.user) return fail(401, "Please sign in.");
  const me = who.user;
  const { data: myProfile } = await admin.from("profiles").select("*").eq("id", me.id).single();
  if (!myProfile || !myProfile.active) return fail(403, "Your account is disabled.");

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail(400, "Request body isn't valid JSON."); }
  const action = body.action;

  // ---- anyone: change own password ----
  if (action === "change_password") {
    const bad = checkPassword(body.newPassword);
    if (bad) return fail(400, bad);
    if (body.newPassword === body.currentPassword) return fail(400, "Choose a password different from the current one.");
    const check = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await check.auth.signInWithPassword({ email: me.email!, password: String(body.currentPassword || "") });
    if (error) return fail(400, "Your current password is wrong.");
    await check.auth.signOut();
    const up = await admin.auth.admin.updateUserById(me.id, { password: String(body.newPassword) });
    if (up.error) return fail(400, up.error.message);
    await admin.from("profiles").update({ must_change_password: false }).eq("id", me.id);
    return reply(200, { ok: true });
  }

  // ---- admin only from here ----
  if (myProfile.role !== "ADMIN" || myProfile.must_change_password) return fail(403, "Only the admin can do this.");

  if (action === "create") {
    const username = String(body.username || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) return fail(400, "Username must be 3–30 characters: lowercase letters, numbers, dot, dash or underscore.");
    const name = text(body.name, 80);
    if (!name) return fail(400, "Name is required.");
    const bad = checkPassword(body.password);
    if (bad) return fail(400, bad);
    const role = body.role === "ADMIN" ? "ADMIN" : "MEMBER";
    const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
    if (taken) return fail(409, "That username is already taken.");
    const created = await admin.auth.admin.createUser({ email: `${username}@${EMAIL_DOMAIN}`, password: String(body.password), email_confirm: true });
    if (created.error || !created.data.user) return fail(400, created.error?.message || "Couldn't create the login.");
    const { error } = await admin.from("profiles").insert({ id: created.data.user.id, username, name, title: text(body.title, 120) || "", role, must_change_password: true });
    if (error) { await admin.auth.admin.deleteUser(created.data.user.id); return fail(400, error.message); }
    return reply(201, { ok: true });
  }

  const target = String(body.id || "");
  const { data: them } = await admin.from("profiles").select("*").eq("id", target).maybeSingle();
  if (!them) return fail(404, "That team member doesn't exist.");

  if (action === "update") {
    const patch: Record<string, unknown> = {};
    const name = text(body.name, 80), title = text(body.title, 120);
    if (name !== undefined) { if (!name) return fail(400, "Name is required."); patch.name = name; }
    if (title !== undefined) patch.title = title;
    if (body.role === "ADMIN" || body.role === "MEMBER") patch.role = body.role;
    if (typeof body.active === "boolean") patch.active = body.active;
    if (target === me.id && (patch.role === "MEMBER" || patch.active === false)) return fail(400, "You can't remove your own admin access.");
    const { error } = await admin.from("profiles").update(patch).eq("id", target);
    if (error) return fail(400, error.message);
    if (typeof patch.active === "boolean") {
      await admin.auth.admin.updateUserById(target, { ban_duration: patch.active ? "none" : "876000h" });
      if (!patch.active) await admin.rpc("admin_sign_out", { target });
    }
    return reply(200, { ok: true });
  }

  if (action === "reset_password") {
    if (target === me.id) return fail(400, "Change your own password on My account.");
    const bad = checkPassword(body.password);
    if (bad) return fail(400, bad);
    const up = await admin.auth.admin.updateUserById(target, { password: String(body.password) });
    if (up.error) return fail(400, up.error.message);
    await admin.from("profiles").update({ must_change_password: true }).eq("id", target);
    await admin.rpc("admin_sign_out", { target });
    return reply(200, { ok: true });
  }

  return fail(400, "Unknown action.");
});

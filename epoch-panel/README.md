# Epoch Panel

Epoch opened on 2 February 2025. Team panel for Epoch: admin panel, team member panel, task board, customers, software assignments, subscription plans, customer payments and money split.

## How it runs

| Part | Where | Files |
|---|---|---|
| Pages (HTML, CSS, JavaScript) | **GitHub Pages** | `public/` |
| Database, logins, permissions | **Supabase** project `epoch-panel` (`pghrlsctyifzpnqoghpw`) | managed in Supabase |
| Team account actions (create login, reset password, disable, change own password) | **Supabase Edge Function** `team-accounts` | `supabase/functions/team-accounts/index.ts` |

There is no server to keep running. On every push to `main`, `.github/workflows/static.yml` publishes `public/` to GitHub Pages.

- `public/js/data.js` connects to Supabase (project URL and the **publishable** key, which is meant to be public).
- `public/js/app.js` is the panel itself.
- Never put the Supabase **secret / service role** key in any file in this repository.

## Signing in

Usernames stay the same (`hishma`, `hansa`, `ravindu`). Behind the scenes Supabase stores each login as `<username>@epoch.invalid`; nobody needs to type that.

New members get a temporary password from Hishma (**Team accounts** page) and must choose their own at first sign-in.

## Who can do what (enforced in Supabase)

| | Hishma (admin) | Members |
|---|---|---|
| Task board | All tasks; add, edit, reassign, delete | Own tasks + whole-team tasks; change status and notes of own tasks; add tasks for themselves |
| Customers, software, subscription plans | Everything | View; add and edit customers |
| Customer payments, revenue, hosting costs | ✓ | Hidden |
| Money split | Everything | Only their own payments, on My panel |
| Team accounts | ✓ | |

These rules are Row Level Security policies and database functions in Supabase, so they hold even if someone edits the page code in their browser.

## Emailing customers

On **Customers**, each customer has an **Email** button: pick a template (introduction, quotation, payment reminder, receipt, welcome or blank), edit it, and send. Every email is logged and shown under that customer.

- Sent by the Supabase Edge Function `send-email` (`supabase/functions/send-email/index.ts`) through **Resend**.
- Only to the email address saved on the customer, and at most **5 emails a day** for the whole team (Sri Lanka time).
- Settings live in the `settings` table: `emailFrom`, `emailReplyTo` (customers' replies go here), `emailDailyLimit`.
- The Resend API key is the Supabase secret `RESEND_API_KEY` (Edge Functions → Secrets). Never put it in this repository.
- Until a domain is verified in Resend, Resend only delivers to the Resend account's own address. After verifying a domain, set `emailFrom` to e.g. `Epoch <hello@yourdomain>`.

## Run the pages on this computer

Any static file server works, for example:

```bash
cd public && python3 -m http.server 8080
```

Then open http://localhost:8080. It uses the same live Supabase data as the online version.

## Old version

`src/` (Express server) and `prisma/` (SQLite) are the earlier local version. All its data was copied to Supabase on 18 Nov 2026; the SQLite files in `prisma/` are kept only as backups and are no longer updated.

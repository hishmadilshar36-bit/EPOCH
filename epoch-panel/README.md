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

New members get a temporary password from the admin (Admin panel → **Team accounts**) and must choose their own at first sign-in.

## Two places

- **Member portal** (`app.html`, sign in at `index.html`): where every team member works, with the same view for everyone: My panel, own tasks, the team's tasks for today (with who has finished), customers, software and plans.
- **Admin panel** (`admin.html`): a separate page with its own address and sign-in (`index.html#admin`); there are no links between it and the member portal. Only people with the Admin role can use it: overview with money, assigning tasks to anyone, customers with payments, customer payments, money split, team accounts, software and plan setup. Anyone else is signed out and told only admins can use it.

## Who can do what (enforced in Supabase)

| | Admin | Members (everyone in the workplace) |
|---|---|---|
| Task board | All tasks; add, edit, reassign, delete | Own tasks + whole-team tasks; change status and notes of own tasks; add tasks for themselves |
| Customers, software, subscription plans | Everything | View; add and edit customers |
| Customer payments, revenue, hosting costs | ✓ | Hidden |
| Money split | Everything | Only their own payments, on My panel |
| Team accounts | ✓ | |

These rules are Row Level Security policies and database functions in Supabase, so they hold even if someone edits the page code in their browser.

## Emailing customers

On **Customers**, each customer has an **Email** button: pick a template (introduction, quotation, payment reminder, receipt, welcome or blank), edit it, and send. Every email is logged and shown under that customer.

- Sent by the Supabase Edge Function `send-email` (`supabase/functions/send-email/index.ts`) from Epoch's **Gmail** account over SMTP (port 465). Gmail keeps a copy in its Sent folder.
- Only to the email address saved on the customer. There's no daily limit in the panel (Gmail itself allows about 500 a day). To add one, put a number in the `emailDailyLimit` setting.
- Settings live in the `settings` table: `emailGmailUser` (the Gmail address that sends), `emailFrom`, `emailReplyTo` (customers' replies go here), optional `emailDailyLimit`.
- The Gmail **App Password** is the Supabase secret `GMAIL_APP_PASSWORD` (Edge Functions → Secrets). It needs 2-Step Verification on the Gmail account. Never put it in this repository.
- Later, with your own domain, this can move to a service like Resend so emails come from e.g. `hello@yourdomain`.

## Run the pages on this computer

Any static file server works, for example:

```bash
cd public && python3 -m http.server 8080
```

Then open http://localhost:8080. It uses the same live Supabase data as the online version.

## Old version

`src/` (Express server) and `prisma/` (SQLite) are the earlier local version. All its data was copied to Supabase on 18 Nov 2026; the SQLite files in `prisma/` are kept only as backups and are no longer updated.

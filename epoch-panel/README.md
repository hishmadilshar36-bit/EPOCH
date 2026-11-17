# Epoch Panel

Epoch opened on 2 February 2025. The opening date lives in `COMPANY` at the top of `src/server.js`; the dashboard shows the company's age and counts down to each anniversary.

Team panel for Epoch: admin panel, team member panel, software assignments, customers, payments and the 30-day task board.

- **Frontend:** plain HTML, CSS and JavaScript (`public/`)
- **Backend:** Node.js + Express (`src/server.js`)
- **Database:** Prisma with SQLite (`prisma/schema.prisma`, data in `prisma/epoch.db`)

## Run it

```bash
npm install
npm run setup     # first time only: creates the database and team accounts
npm start         # opens on http://localhost:3000
```

`npm run setup` writes each person's first-time password to `prisma/initial-passwords.txt`.
Give each person only their own line, then delete the file. Everyone must choose a new
password the first time they sign in.

## Who can do what

| | Hishma (admin) | Hansa, Ravindu (members) |
|---|---|---|
| Dashboard, task board, customers, software | ✓ | ✓ |
| Update status and notes of own tasks | ✓ | ✓ |
| Edit, reassign and delete any task | ✓ | |
| Add, edit customers | ✓ | ✓ |
| Delete customers | ✓ | |
| Add software, assign people to software | ✓ | |
| Payments and revenue figures | ✓ | |
| Create team sign-ins, reset passwords, disable accounts | ✓ | |

## Pages

- **Dashboard:** plan day, free-period warnings, team progress, your current tasks, customer pipeline, and revenue for the admin.
- **Task board:** the 30-day plan (Day 1 = 18 Nov 2026) in 7 phases plus "Current customers".
- **Customers:** leads → free trial → active subscriber, with software, monthly fee and free-period end date.
- **Software:** Clinic Medical System, E-commerce Website, Smart POS System and Business Website, with who handles development, design, sales, support and video.
- **Payments (admin):** setup fees and monthly payments, mark as paid, and one click to add this month's charges for every active subscriber.
- **Team (admin):** add members with a username and temporary password, change roles, reset passwords, disable access.

## Notes

- Passwords are stored as bcrypt hashes. Sign-in is locked for 15 minutes after 5 wrong attempts.
- Sessions last 7 days. Changing your password signs out your other devices.
- To put it online for the team, run it on a server behind HTTPS (for example a small VPS with Nginx).
  To use PostgreSQL instead of SQLite, change `provider` in `prisma/schema.prisma` and `DATABASE_URL` in `.env`, then run `npx prisma db push`.
- `npm run studio` opens Prisma Studio to view the raw data.
